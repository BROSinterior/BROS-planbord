"""Het app-venster van Plan2CAD.

Sleep een plan naar binnen, controleer de schaal, klik op omzetten.
"""

from __future__ import annotations

import math
import os
import re
import sys
import traceback
from typing import List, Optional

import numpy as np
from PySide6.QtCore import QEvent, QPointF, QRectF, Qt, QThread, QTimer, Signal
from PySide6.QtGui import (QColor, QFont, QImage, QPainter, QPainterPath, QPen,
                           QPixmap, QPolygonF, QTransform)
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QFileDialog,
                               QFormLayout, QFrame, QGroupBox, QHBoxLayout, QInputDialog,
                               QLabel, QMainWindow, QMessageBox, QPlainTextEdit,
                               QPushButton, QSizePolicy, QSplitter,
                               QVBoxLayout, QWidget)

from . import dwguit, vectorpdf
from .model import SchaalKandidaat
from .pijplijn import AFBEELDINGEN, Analyse, Opties, analyseer, bronnen, converteer
from .schaal import schaal_uit_kalibratie
from .units import PAPIERFORMATEN, formatteer_schaal

TITEL = "Plan2CAD - plannen op ware grootte"


# ------------------------------------------------------------------ achtergrondwerk

class Werker(QThread):
    klaar = Signal(object)
    mislukt = Signal(str)
    voortgang = Signal(str)

    def __init__(self, functie, *args, met_voortgang: bool = False, **kwargs):
        super().__init__()
        self._functie = functie
        self._args = args
        self._kwargs = kwargs
        self._met_voortgang = met_voortgang

    def run(self):
        try:
            if self._met_voortgang:
                self._kwargs["voortgang"] = self.voortgang.emit
            self.klaar.emit(self._functie(*self._args, **self._kwargs))
        except Exception:
            self.mislukt.emit(traceback.format_exc())


# ------------------------------------------------------------------ voorbeeldweergave

class Voorbeeld(QWidget):
    """Toont het plan met de gevonden lijnen erover, en laat twee punten aanduiden.

    Zoomen met het scrollwiel (of knijpen op een trackpad) rond de cursor,
    verschuiven door te slepen, dubbelklikken om alles weer passend te zien.
    Bij het aanduiden klikt de cursor vast op hoekpunten en lijnen van de
    tekening - dat is nauwkeuriger dan het beeld, want het zijn de echte
    coordinaten. Alt (Option op een Mac) ingedrukt houden zet dat uit.
    """

    punt_gekozen = Signal(float, float)     # in papier-mm
    geannuleerd = Signal()
    punt_verwijderd = Signal()
    zoom_gewijzigd = Signal(float)          # 1.0 = passend

    VANG_HOEKPUNT_PX = 12                   # vastklikstraal in schermpixels
    VANG_LIJN_PX = 8
    RAND = 8

    def __init__(self):
        super().__init__()
        self.setMinimumSize(420, 320)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.StrongFocus)
        self._pixmap: Optional[QPixmap] = None
        self._analyse: Optional[Analyse] = None
        self._kalibreren = False
        self._punten: List[tuple] = []
        self.toon_lijnen = True
        self.schaalnoemer: Optional[float] = None   # voor de live werkelijke maat
        # beeld: schermpixels per voorbeeldpixel en plaats van de linkerbovenhoek
        self._schaal = 1.0
        self._ox = self._oy = 0.0
        self._passend = True
        # slepen
        self._sleep_start: Optional[QPointF] = None
        self._sleep_oorsprong = (0.0, 0.0)
        self._sleep_knop = None
        self._gesleept = False
        # muis en vastklikken
        self._muis: Optional[QPointF] = None
        self._vang: Optional[tuple] = None      # ((x_mm, y_mm), "hoekpunt" | "lijn")
        self._rooster_cel = 2.0
        self._rooster_hoekpunten = None
        self._rooster_lijnen = None
        self._pad_lijnen: Optional[QPainterPath] = None
        self._pad_vlakken: Optional[QPainterPath] = None
        # Het plan met de lijnen erover wordt een keer getekend en bewaard:
        # duizenden lijnen bij elke muisbeweging opnieuw tekenen maakt het
        # aanduiden stroef. Tijdens zoomen en slepen even zonder anti-aliasing
        # (vijf keer sneller), daarna weer scherp.
        self._basis: Optional[QPixmap] = None
        self._basis_sleutel = None
        self._snel = False
        self._scherp_timer = QTimer(self)
        self._scherp_timer.setSingleShot(True)
        self._scherp_timer.setInterval(200)
        self._scherp_timer.timeout.connect(self._weer_scherp)
        self.setCursor(Qt.ArrowCursor)

    def _in_beweging(self):
        self._snel = True
        self._scherp_timer.start()

    def _weer_scherp(self):
        if self._sleep_start is not None and self._gesleept:
            self._scherp_timer.start()      # nog aan het slepen
            return
        self._snel = False
        self.update()

    # -- gegevens

    def zet_analyse(self, analyse: Optional[Analyse]):
        self._analyse = analyse
        self._punten = []
        self._pixmap = None
        self._vang = None
        self._rooster_hoekpunten = self._rooster_lijnen = None
        self._pad_lijnen = self._pad_vlakken = None
        if analyse is not None and analyse.voorbeeld is not None:
            self._pixmap = _naar_pixmap(analyse.voorbeeld)
            self._bouw_paden()
        self.pas_in()

    def _bouw_paden(self):
        """Het lijnwerk een keer als QPainterPath in papier-mm: tekenen gebeurt
        dan in Qt zelf, zodat zoomen en bewegen vlot blijven bij duizenden lijnen."""
        lijnen, vlakken = QPainterPath(), QPainterPath()
        for pl in self._analyse.tekening.polylijnen:
            doel = vlakken if pl.vulling else lijnen
            for pad in [pl.punten] + list(pl.extra_paden):
                if len(pad) < 2:
                    continue
                polygoon = QPolygonF([QPointF(x, y) for x, y in pad])
                if pl.gesloten or pl.vulling:
                    polygoon.append(polygoon[0])
                doel.addPolygon(polygoon)
        self._pad_lijnen, self._pad_vlakken = lijnen, vlakken

    def start_kalibratie(self):
        self._kalibreren = True
        self._punten = []
        self._bouw_vangrooster()
        self.setCursor(Qt.CrossCursor)
        self.setFocus()
        self._werk_vang_bij()
        self.update()

    def stop_kalibratie(self):
        self._kalibreren = False
        self._vang = None
        self.setCursor(Qt.ArrowCursor)
        self.update()

    def verwijder_laatste_punt(self):
        if self._punten:
            self._punten.pop()
            self.punt_verwijderd.emit()
            self.update()

    # -- omrekenen

    def _blad(self):
        t = self._analyse.tekening
        return (t.blad_breedte_mm or 1.0), (t.blad_hoogte_mm or 1.0)

    def _past_schaal(self) -> float:
        b = max(1, self.width() - 2 * self.RAND)
        h = max(1, self.height() - 2 * self.RAND)
        pm = self._pixmap.size()
        return min(b / pm.width(), h / pm.height())

    def pas_in(self):
        if self._pixmap is not None:
            self._schaal = self._past_schaal()
            pm = self._pixmap.size()
            self._ox = (self.width() - pm.width() * self._schaal) / 2
            self._oy = (self.height() - pm.height() * self._schaal) / 2
        self._passend = True
        self.zoom_gewijzigd.emit(1.0)
        self._werk_vang_bij()
        self.update()

    def zoom(self, factor: float, rond: Optional[QPointF] = None):
        if self._pixmap is None:
            return
        rond = rond if rond is not None else QPointF(self.width() / 2, self.height() / 2)
        past = self._past_schaal()
        # tot 40 schermpixels per voorbeeldpixel: dan zie je de inkt van een
        # lijn van 0,1 mm als een brede band en kies je er het midden van
        nieuw = min(max(self._schaal * factor, past * 0.5), max(past * 2, 40.0))
        f = nieuw / self._schaal
        self._ox = rond.x() - (rond.x() - self._ox) * f
        self._oy = rond.y() - (rond.y() - self._oy) * f
        self._schaal = nieuw
        self._passend = False
        self._in_beweging()
        self.zoom_gewijzigd.emit(nieuw / past)
        self._werk_vang_bij()
        self.update()

    def _transformatie(self) -> QTransform:
        """Papier-mm (y naar boven) naar schermpixels (y naar onder)."""
        breedte, hoogte = self._blad()
        pm = self._pixmap.size()
        sx = self._schaal * pm.width() / breedte
        sy = self._schaal * pm.height() / hoogte
        return QTransform(sx, 0, 0, -sy, self._ox, self._oy + self._schaal * pm.height())

    def _scherm_naar_mm(self, punt: QPointF):
        if self._pixmap is None or self._analyse is None:
            return None
        breedte, hoogte = self._blad()
        pm = self._pixmap.size()
        px = (punt.x() - self._ox) / self._schaal
        py = (punt.y() - self._oy) / self._schaal
        if not (0 <= px <= pm.width() and 0 <= py <= pm.height()):
            return None
        return (px / pm.width() * breedte, (1.0 - py / pm.height()) * hoogte)

    def _mm_naar_scherm(self, mm_punt) -> QPointF:
        return self._transformatie().map(QPointF(mm_punt[0], mm_punt[1]))

    def _mm_per_schermpixel(self) -> float:
        breedte, _ = self._blad()
        return breedte / (self._pixmap.width() * self._schaal)

    # -- vastklikken

    def _bouw_vangrooster(self):
        if self._analyse is None or self._rooster_hoekpunten is not None:
            return
        breedte, hoogte = self._blad()
        cel = self._rooster_cel = max(2.0, max(breedte, hoogte) / 250.0)
        hoekpunten, lijnen = {}, {}
        for pl in self._analyse.tekening.polylijnen:
            for pad in [pl.punten] + list(pl.extra_paden):
                punten = list(pad)
                if len(punten) < 2:
                    continue
                for p in punten:
                    hoekpunten.setdefault((int(p[0] // cel), int(p[1] // cel)), []).append(p)
                if pl.gesloten or pl.vulling:
                    punten.append(punten[0])
                for a, b in zip(punten, punten[1:]):
                    lengte = math.hypot(b[0] - a[0], b[1] - a[1])
                    stappen = int(lengte / (cel * 0.5)) + 1
                    cellen = set()
                    for i in range(stappen + 1):
                        t = i / stappen
                        cellen.add((int((a[0] + t * (b[0] - a[0])) // cel),
                                    int((a[1] + t * (b[1] - a[1])) // cel)))
                    for c in cellen:
                        lijnen.setdefault(c, []).append((a, b))
        self._rooster_hoekpunten, self._rooster_lijnen = hoekpunten, lijnen

    def _zoek_vang(self, mm_punt):
        if self._rooster_hoekpunten is None:
            return None
        x, y = mm_punt
        cel = self._rooster_cel
        per_px = self._mm_per_schermpixel()
        r_hoek = self.VANG_HOEKPUNT_PX * per_px
        r_lijn = self.VANG_LIJN_PX * per_px
        n = int(math.ceil(r_hoek / cel))
        cx, cy = int(x // cel), int(y // cel)

        beste, beste_d = None, r_hoek
        for i in range(cx - n, cx + n + 1):
            for j in range(cy - n, cy + n + 1):
                for p in self._rooster_hoekpunten.get((i, j), ()):
                    d = math.hypot(p[0] - x, p[1] - y)
                    if d < beste_d:
                        beste, beste_d = p, d
        if beste is not None:
            return (beste, "hoekpunt")

        n = int(math.ceil(r_lijn / cel))
        beste_d = r_lijn
        gezien = set()
        for i in range(cx - n, cx + n + 1):
            for j in range(cy - n, cy + n + 1):
                for a, b in self._rooster_lijnen.get((i, j), ()):
                    sleutel = (a, b)
                    if sleutel in gezien:
                        continue
                    gezien.add(sleutel)
                    dx, dy = b[0] - a[0], b[1] - a[1]
                    l2 = dx * dx + dy * dy
                    if l2 <= 0:
                        continue
                    t = max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
                    p = (a[0] + t * dx, a[1] + t * dy)
                    d = math.hypot(p[0] - x, p[1] - y)
                    if d < beste_d:
                        beste, beste_d = p, d
        return (beste, "lijn") if beste is not None else None

    def _werk_vang_bij(self, modifiers=None):
        self._vang = None
        if not self._kalibreren or self._muis is None or self._pixmap is None:
            return
        if modifiers is None:
            modifiers = QApplication.keyboardModifiers()
        if modifiers & Qt.AltModifier:
            return
        mm = self._scherm_naar_mm(self._muis)
        if mm is not None:
            self._vang = self._zoek_vang(mm)

    def _huidig_punt(self):
        """Het punt dat een klik nu zou kiezen: het vastgeklikte, anders de cursor."""
        if self._vang is not None:
            return self._vang[0]
        return self._scherm_naar_mm(self._muis) if self._muis is not None else None

    # -- muis en toetsen

    def wheelEvent(self, event):
        if self._pixmap is None:
            return
        delta = event.angleDelta().y() or event.angleDelta().x()
        if delta:
            self.zoom(1.0015 ** delta, event.position())
        event.accept()

    def event(self, event):
        # knijpen op een trackpad
        if event.type() == QEvent.NativeGesture and \
                event.gestureType() == Qt.ZoomNativeGesture:
            self.zoom(1.0 + event.value(), event.position())
            return True
        return super().event(event)

    def mousePressEvent(self, event):
        if self._pixmap is None:
            return
        self.setFocus()
        self._sleep_start = event.position()
        self._sleep_oorsprong = (self._ox, self._oy)
        self._sleep_knop = event.button()
        self._gesleept = False

    def mouseMoveEvent(self, event):
        self._muis = event.position()
        if self._sleep_start is not None:
            d = event.position() - self._sleep_start
            if self._gesleept or abs(d.x()) + abs(d.y()) > 4:
                self._gesleept = True
                self._ox = self._sleep_oorsprong[0] + d.x()
                self._oy = self._sleep_oorsprong[1] + d.y()
                self._passend = False
                self._in_beweging()
                self.setCursor(Qt.ClosedHandCursor)
        self._werk_vang_bij(event.modifiers())
        self.update()

    def mouseReleaseEvent(self, event):
        if self._sleep_start is None:
            return
        klik = not self._gesleept and self._sleep_knop == Qt.LeftButton
        self._sleep_start = None
        self._gesleept = False
        self.setCursor(Qt.CrossCursor if self._kalibreren else Qt.ArrowCursor)
        if not (klik and self._kalibreren):
            return
        self._muis = event.position()
        self._werk_vang_bij(event.modifiers())
        mm = self._huidig_punt()
        if mm is None:
            return
        self._punten.append(mm)
        self.update()
        self.punt_gekozen.emit(float(mm[0]), float(mm[1]))

    def mouseDoubleClickEvent(self, event):
        # tijdens het aanduiden zou een dubbelklik het beeld onder je klik
        # wegtrekken; daar dient de knop "Passend" of de toets 0 voor
        if not self._kalibreren:
            self.pas_in()

    def leaveEvent(self, event):
        self._muis = None
        self._vang = None
        self.update()

    def keyPressEvent(self, event):
        toets = event.key()
        if toets == Qt.Key_Escape and self._kalibreren:
            self.stop_kalibratie()
            self._punten = []
            self.geannuleerd.emit()
        elif toets == Qt.Key_Backspace and self._kalibreren:
            self.verwijder_laatste_punt()
        elif toets in (Qt.Key_Plus, Qt.Key_Equal):
            self.zoom(1.5, self._muis)
        elif toets == Qt.Key_Minus:
            self.zoom(1 / 1.5, self._muis)
        elif toets == Qt.Key_0:
            self.pas_in()
        elif toets == Qt.Key_Alt:
            self._werk_vang_bij(event.modifiers())
            self.update()
        else:
            super().keyPressEvent(event)

    def keyReleaseEvent(self, event):
        if event.key() == Qt.Key_Alt:
            self._werk_vang_bij(event.modifiers())
            self.update()
        super().keyReleaseEvent(event)

    def resizeEvent(self, event):
        if self._passend:
            self.pas_in()
        super().resizeEvent(event)

    # -- tekenen

    def paintEvent(self, event):
        schilder = QPainter(self)
        schilder.setRenderHint(QPainter.Antialiasing)
        schilder.fillRect(self.rect(), QColor("#1e1f22"))

        if self._pixmap is None:
            schilder.setPen(QColor("#9aa0a6"))
            schilder.setFont(QFont("", 13))
            schilder.drawText(self.rect(), Qt.AlignCenter,
                              "Sleep hier een PDF of een foto van een plan naartoe\n\n"
                              "PDF · JPG · PNG · TIFF")
            return

        sleutel = (round(self._ox, 2), round(self._oy, 2), self._schaal, self.width(),
                   self.height(), self.devicePixelRatioF(), self.toon_lijnen, self._snel,
                   self._pixmap.cacheKey())
        if self._basis is None or self._basis_sleutel != sleutel:
            self._basis = self._teken_basis()
            self._basis_sleutel = sleutel
        schilder.drawPixmap(0, 0, self._basis)

        # kalibratiepunten
        rood = QColor("#ff5c5c")
        scherm = [self._mm_naar_scherm(p) for p in self._punten]
        if scherm:
            pen = QPen(rood)
            pen.setWidth(2)
            schilder.setPen(pen)
            if len(scherm) >= 2:
                schilder.drawLine(scherm[0], scherm[1])
            for p in scherm:
                _kruisje(schilder, p, 7)

        hulp_vak = self._teken_hulp(schilder) if self._kalibreren else None
        if self._kalibreren and self._muis is not None:
            huidig = self._huidig_punt()
            if huidig is not None:
                hp = self._mm_naar_scherm(huidig)
                if len(self._punten) == 1:
                    pen = QPen(rood)
                    pen.setWidthF(1.5)
                    pen.setStyle(Qt.DashLine)
                    schilder.setPen(pen)
                    schilder.drawLine(scherm[0], hp)
                    self._teken_afstand(schilder, self._punten[0], huidig, hp, hulp_vak)
                if self._vang is not None:
                    pen = QPen(QColor("#ffd400"))
                    pen.setWidth(2)
                    schilder.setPen(pen)
                    schilder.setBrush(Qt.NoBrush)
                    if self._vang[1] == "hoekpunt":
                        schilder.drawRect(QRectF(hp.x() - 6, hp.y() - 6, 12, 12))
                    else:
                        schilder.drawPolygon(QPolygonF([
                            QPointF(hp.x(), hp.y() - 7), QPointF(hp.x() + 7, hp.y()),
                            QPointF(hp.x(), hp.y() + 7), QPointF(hp.x() - 7, hp.y())]))

    def _teken_basis(self) -> QPixmap:
        """Het plan met de gevonden lijnen, voor de huidige zoom en plaats."""
        dpr = self.devicePixelRatioF()
        basis = QPixmap(max(1, int(self.width() * dpr)), max(1, int(self.height() * dpr)))
        basis.setDevicePixelRatio(dpr)
        basis.fill(QColor("#1e1f22"))
        schilder = QPainter(basis)
        schilder.setRenderHint(QPainter.Antialiasing, not self._snel)
        # enkel het zichtbare stuk van het beeld schalen: ingezoomd op een
        # groot plan blijft dat zo vlot
        pm = self._pixmap
        doel = QRectF(self._ox, self._oy, pm.width() * self._schaal, pm.height() * self._schaal)
        zichtbaar = doel.intersected(QRectF(self.rect()))
        if not zichtbaar.isEmpty():
            bron = QRectF((zichtbaar.x() - self._ox) / self._schaal,
                          (zichtbaar.y() - self._oy) / self._schaal,
                          zichtbaar.width() / self._schaal,
                          zichtbaar.height() / self._schaal)
            # sterk ingezoomd: scherpe pixels, zodat je ziet waar de inkt echt ligt
            schilder.setRenderHint(QPainter.SmoothPixmapTransform, self._schaal < 3)
            schilder.drawPixmap(zichtbaar, pm, bron)
        schilder.setPen(QPen(QColor("#3c4043"), 1))
        schilder.setBrush(Qt.NoBrush)
        schilder.drawRect(doel)

        if self.toon_lijnen and self._pad_lijnen is not None:
            schilder.save()
            schilder.setTransform(self._transformatie())
            pen = QPen(QColor(0, 190, 255, 200))
            pen.setWidthF(1.2)
            pen.setCosmetic(True)           # dikte in schermpixels, ook ingezoomd
            schilder.setPen(pen)
            schilder.drawPath(self._pad_lijnen)
            pen.setColor(QColor(0, 190, 255, 90))
            schilder.setPen(pen)
            schilder.drawPath(self._pad_vlakken)
            schilder.restore()

        schilder.end()
        return basis

    def _teken_afstand(self, schilder, a, b, plek: QPointF, vermijd: Optional[QRectF] = None):
        papier = math.hypot(b[0] - a[0], b[1] - a[1])
        tekst = f"{papier:.2f} mm op het blad".replace(".", ",")
        if self.schaalnoemer:
            werkelijk = f"{papier * self.schaalnoemer:,.0f}".replace(",", ".")
            tekst += f"\n≈ {werkelijk} mm bij {formatteer_schaal(self.schaalnoemer)}"
        schilder.setFont(QFont("", 11))
        vak = schilder.boundingRect(QRectF(0, 0, 400, 100), Qt.AlignLeft, tekst)
        vak.moveTo(plek.x() + 16, plek.y() + 16)
        if vak.right() > self.width() - 4:
            vak.moveRight(plek.x() - 16)
        onderkant = vermijd.top() - 8 if vermijd is not None else self.height() - 4
        if vak.bottom() > onderkant:
            vak.moveBottom(plek.y() - 16)
        schilder.setPen(Qt.NoPen)
        schilder.setBrush(QColor(20, 20, 22, 220))
        schilder.drawRoundedRect(vak.adjusted(-6, -4, 6, 4), 4, 4)
        schilder.setPen(QColor("#ffffff"))
        schilder.drawText(vak, Qt.AlignLeft, tekst)

    def _teken_hulp(self, schilder):
        tekst = ("Scrollen of knijpen = zoomen  ·  slepen = verschuiven  ·  0 = passend\n"
                 "Klikt vast op hoekpunten (vierkant) en lijnen (ruit)  ·  Alt/Option = los  ·  "
                 "Backspace = punt terug  ·  Esc = stoppen")
        schilder.setFont(QFont("", 10))
        vak = schilder.boundingRect(QRectF(0, 0, self.width() - 40, 200),
                                    Qt.AlignLeft | Qt.TextWordWrap, tekst)
        vak.moveTo(14, self.height() - vak.height() - 14)
        # werk je onderaan het plan, dan gaat de uitleg uit de weg
        if self._muis is not None and vak.adjusted(-30, -50, 30, 30).contains(self._muis):
            return None
        schilder.setPen(Qt.NoPen)
        schilder.setBrush(QColor(20, 20, 22, 200))
        schilder.drawRoundedRect(vak.adjusted(-6, -4, 6, 4), 4, 4)
        schilder.setPen(QColor("#d0d3d6"))
        schilder.drawText(vak, Qt.AlignLeft | Qt.TextWordWrap, tekst)
        return vak.adjusted(-6, -4, 6, 4)


def _kruisje(schilder, p: QPointF, r: float):
    schilder.drawLine(QPointF(p.x() - r, p.y()), QPointF(p.x() + r, p.y()))
    schilder.drawLine(QPointF(p.x(), p.y() - r), QPointF(p.x(), p.y() + r))
    schilder.setBrush(Qt.NoBrush)
    schilder.drawEllipse(p, r * 0.6, r * 0.6)


def _naar_pixmap(beeld: np.ndarray) -> QPixmap:
    if beeld.ndim == 2:
        beeld = np.stack([beeld] * 3, axis=-1)
    beeld = np.ascontiguousarray(beeld[:, :, ::-1])      # BGR -> RGB
    h, w, _ = beeld.shape
    afbeelding = QImage(beeld.data, w, h, 3 * w, QImage.Format_RGB888).copy()
    return QPixmap.fromImage(afbeelding)


# ------------------------------------------------------------------ hoofdvenster

class Hoofdvenster(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(TITEL)
        self.resize(1180, 760)
        self.setAcceptDrops(True)

        self.bestand: Optional[str] = None
        self.analyse: Optional[Analyse] = None
        self.werker: Optional[Werker] = None
        self._oude_werkers: List[Werker] = []
        self.kalibratiepunten: List[tuple] = []

        self.voorbeeld = Voorbeeld()
        self.voorbeeld.punt_gekozen.connect(self._punt_gekozen)
        self.voorbeeld.punt_verwijderd.connect(self._punt_verwijderd)
        self.voorbeeld.geannuleerd.connect(
            lambda: self.statusBar().showMessage("Aanduiden gestopt."))

        # zoombalk onder het voorbeeld
        links = QWidget()
        kolom_links = QVBoxLayout(links)
        kolom_links.setContentsMargins(0, 0, 0, 0)
        kolom_links.setSpacing(4)
        kolom_links.addWidget(self.voorbeeld, 1)
        balk = QHBoxLayout()
        balk.setContentsMargins(8, 0, 8, 6)
        knop_uit = QPushButton("−")
        knop_in = QPushButton("+")
        knop_passend = QPushButton("Passend")
        for knop in (knop_uit, knop_in):
            knop.setFixedWidth(34)
        knop_uit.setToolTip("Uitzoomen (toets -)")
        knop_in.setToolTip("Inzoomen (toets +) - of scroll met de muis / knijp op het trackpad")
        knop_passend.setToolTip("Het hele plan tonen (toets 0, of dubbelklik)")
        knop_uit.clicked.connect(lambda: self.voorbeeld.zoom(1 / 1.5))
        knop_in.clicked.connect(lambda: self.voorbeeld.zoom(1.5))
        knop_passend.clicked.connect(self.voorbeeld.pas_in)
        self.label_zoom = QLabel("passend")
        self.label_zoom.setStyleSheet("color:#9aa0a6;")
        self.voorbeeld.zoom_gewijzigd.connect(
            lambda z: self.label_zoom.setText("passend" if abs(z - 1) < 1e-3
                                              else f"zoom {z:.1f}x".replace(".", ",")))
        balk.addWidget(knop_uit)
        balk.addWidget(knop_in)
        balk.addWidget(knop_passend)
        balk.addWidget(self.label_zoom)
        balk.addStretch(1)
        hint = QLabel("scrollen = zoomen · slepen = verschuiven")
        hint.setStyleSheet("color:#6f757b;")
        balk.addWidget(hint)
        kolom_links.addLayout(balk)

        rechts = QWidget()
        kolom = QVBoxLayout(rechts)
        kolom.setContentsMargins(14, 14, 14, 14)
        kolom.setSpacing(12)

        # --- bestand
        vak_bestand = QGroupBox("Plan")
        lay = QVBoxLayout(vak_bestand)
        self.label_bestand = QLabel("Nog geen bestand gekozen")
        self.label_bestand.setWordWrap(True)
        knop_open = QPushButton("Bestand kiezen...")
        knop_open.clicked.connect(self.kies_bestand)
        rij_bron = QHBoxLayout()
        rij_bron.addWidget(QLabel("Bron"))
        # Een pagina, of een plannetje op een pagina: een verslag met twee
        # geplakte plannen geeft er twee, elk met een eigen schaal.
        self.keuze_bron = QComboBox()
        self.keuze_bron.setSizeAdjustPolicy(QComboBox.AdjustToMinimumContentsLengthWithIcon)
        self.keuze_bron.setMinimumContentsLength(20)
        self.keuze_bron.addItem("-", (0, None))
        self.keuze_bron.setEnabled(False)
        self.keuze_bron.currentIndexChanged.connect(lambda _: self.start_analyse())
        rij_bron.addWidget(self.keuze_bron, 1)
        rij = QHBoxLayout()
        rij.addWidget(QLabel("Papierformaat (foto's)"))
        self.keuze_papier = QComboBox()
        self.keuze_papier.addItem("automatisch", None)
        for naam in PAPIERFORMATEN:
            self.keuze_papier.addItem(naam, naam)
        self.keuze_papier.currentIndexChanged.connect(lambda _: self.start_analyse())
        rij.addWidget(self.keuze_papier)
        lay.addWidget(self.label_bestand)
        lay.addWidget(knop_open)
        lay.addLayout(rij_bron)
        lay.addLayout(rij)
        kolom.addWidget(vak_bestand)

        # --- schaal
        vak_schaal = QGroupBox("Schaal")
        lay_s = QVBoxLayout(vak_schaal)
        self.keuze_schaal = QComboBox()
        self.keuze_schaal.setEditable(False)
        self.keuze_schaal.currentIndexChanged.connect(self._schaal_gewijzigd)
        self.label_uitleg = QLabel("")
        self.label_uitleg.setWordWrap(True)
        self.label_uitleg.setMinimumHeight(60)
        self.label_uitleg.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        self.label_uitleg.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.MinimumExpanding)
        self.label_uitleg.setStyleSheet("color:#9aa0a6;")
        knoppen = QHBoxLayout()
        self.knop_kalibreer = QPushButton("Twee punten aanduiden...")
        self.knop_kalibreer.clicked.connect(self.start_kalibratie)
        self.knop_handmatig = QPushButton("Schaal ingeven...")
        self.knop_handmatig.clicked.connect(self.schaal_ingeven)
        knoppen.addWidget(self.knop_kalibreer)
        knoppen.addWidget(self.knop_handmatig)
        lay_s.addWidget(self.keuze_schaal)
        lay_s.addWidget(self.label_uitleg)
        lay_s.addLayout(knoppen)
        kolom.addWidget(vak_schaal)

        # --- opties
        vak_opties = QGroupBox("Uitvoer")
        vorm = QFormLayout(vak_opties)
        self.vink_tekst = QCheckBox("Tekst meenemen")
        self.vink_tekst.setChecked(True)
        self.vink_haaks = QCheckBox("Bijna-rechte lijnen haaks zetten (scans en foto's)")
        self.vink_haaks.setChecked(True)
        self.vink_controle = QCheckBox("Controlevierkant van 1 x 1 m toevoegen")
        self.vink_controle.setChecked(True)
        self.vink_dwg = QCheckBox("Ook een DWG maken")
        self.vink_dwg.setChecked(dwguit.zoek_oda() is not None)
        self.vink_lijnen = QCheckBox("Gevonden lijnen in het voorbeeld tonen")
        self.vink_lijnen.setChecked(True)
        self.vink_lijnen.toggled.connect(self._toon_lijnen)
        vorm.addRow(self.vink_tekst)
        vorm.addRow(self.vink_haaks)
        vorm.addRow(self.vink_controle)
        vorm.addRow(self.vink_dwg)
        vorm.addRow(self.vink_lijnen)
        self.label_oda = QLabel()
        self.label_oda.setWordWrap(True)
        self.label_oda.setStyleSheet("color:#9aa0a6;")
        self._werk_oda_bij()
        vorm.addRow(self.label_oda)
        kolom.addWidget(vak_opties)

        # --- omzetten
        self.knop_omzetten = QPushButton("Omzetten naar DXF")
        self.knop_omzetten.setMinimumHeight(40)
        self.knop_omzetten.setEnabled(False)
        self.knop_omzetten.clicked.connect(self.omzetten)
        self.vink_dwg.toggled.connect(
            lambda aan: self.knop_omzetten.setText("Omzetten naar DXF + DWG" if aan
                                                   else "Omzetten naar DXF"))
        kolom.addWidget(self.knop_omzetten)

        self.logboek = QPlainTextEdit()
        self.logboek.setReadOnly(True)
        self.logboek.setMaximumBlockCount(500)
        kolom.addWidget(self.logboek, 1)

        splitser = QSplitter()
        splitser.addWidget(links)
        splitser.addWidget(rechts)
        splitser.setStretchFactor(0, 3)
        splitser.setStretchFactor(1, 2)
        splitser.setSizes([700, 480])
        self.setCentralWidget(splitser)

        self.statusBar().showMessage("Sleep een plan in het venster om te beginnen.")
        self.log("Plan2CAD klaar. Vector-PDF's worden exact overgenomen; "
                 "scans en foto's worden gevectoriseerd.")

    # -------------------------------------------------- hulpjes

    def log(self, tekst: str):
        self.logboek.appendPlainText(tekst)

    def _start_werker(self, functie, *args, met_voortgang: bool = False, **kwargs) -> Werker:
        """Start achtergrondwerk en laat een eventuele vorige netjes uitlopen.

        Wie tijdens een trage scan van pagina of papierformaat wisselt, start
        een tweede analyse. De vorige gewoon overschrijven laat Qt een draaiende
        thread opruimen - dat breekt af met "QThread destroyed while running" -
        en zou bovendien een verlaat resultaat over het nieuwe heen zetten.
        """
        vorige = self.werker
        if vorige is not None and vorige.isRunning():
            for signaal in (vorige.klaar, vorige.mislukt, vorige.voortgang):
                try:
                    signaal.disconnect()
                except (TypeError, RuntimeError):
                    pass
            self._oude_werkers.append(vorige)
            vorige.finished.connect(lambda w=vorige: self._vergeet_werker(w))

        werker = Werker(functie, *args, met_voortgang=met_voortgang, **kwargs)
        self.werker = werker
        return werker

    def _vergeet_werker(self, werker: Werker):
        if werker in self._oude_werkers:
            self._oude_werkers.remove(werker)

    def _werk_oda_bij(self):
        status = dwguit.status()
        if status["beschikbaar"]:
            self.label_oda.setText(f"ODA File Converter gevonden - DWG is mogelijk.")
        else:
            self.vink_dwg.setChecked(False)
            self.vink_dwg.setEnabled(False)
            self.label_oda.setText(
                "Geen ODA File Converter gevonden, dus enkel DXF. Vectorworks en AutoCAD "
                f"importeren DXF probleemloos op ware grootte. Wil je toch DWG: {status['download']}")

    def _toon_lijnen(self, aan: bool):
        self.voorbeeld.toon_lijnen = aan
        self.voorbeeld.update()

    def huidige_opties(self) -> Opties:
        pagina, afbeelding = self.keuze_bron.currentData() or (0, None)
        return Opties(
            pagina=pagina,
            afbeelding=afbeelding,
            papierformaat=self.keuze_papier.currentData(),
            met_tekst=self.vink_tekst.isChecked(),
            haaks_zetten=self.vink_haaks.isChecked(),
            controlevierkant=self.vink_controle.isChecked(),
            dwg=self.vink_dwg.isChecked(),
        )

    # -------------------------------------------------- slepen

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event):
        for url in event.mimeData().urls():
            pad = url.toLocalFile()
            if pad:
                self.open_bestand(pad)
                break

    # -------------------------------------------------- bestand

    def kies_bestand(self):
        filters = "Plannen (*.pdf *.jpg *.jpeg *.png *.tif *.tiff *.bmp *.webp);;Alle bestanden (*)"
        pad, _ = QFileDialog.getOpenFileName(self, "Kies een plan", "", filters)
        if pad:
            self.open_bestand(pad)

    def open_bestand(self, pad: str):
        ext = os.path.splitext(pad)[1].lower()
        if ext != ".pdf" and ext not in AFBEELDINGEN:
            QMessageBox.warning(self, TITEL, f"Dit bestandstype ({ext}) kan ik niet lezen.\n"
                                             "Gebruik een PDF of een foto van het plan.")
            return
        self.bestand = pad
        self.label_bestand.setText(os.path.basename(pad))
        self.keuze_bron.blockSignals(True)
        self.keuze_bron.clear()
        lijst = []
        try:
            lijst = bronnen(pad)
        except Exception as exc:
            self.log(f"Kan de inhoud niet overlopen: {exc}")
            try:
                lijst = [{"pagina": i["nummer"], "afbeelding": None, "bruikbaar": True,
                          "label": f"Pagina {i['nummer'] + 1}"}
                         for i in vectorpdf.pagina_info(pad)] if ext == ".pdf" else []
            except Exception:
                lijst = []
        if not lijst:
            lijst = [{"pagina": 0, "afbeelding": None, "bruikbaar": True,
                      "label": os.path.basename(pad)}]
        for b in lijst:
            self.keuze_bron.addItem(b["label"], (b["pagina"], b["afbeelding"]))
        # meteen het eerste echte plan, niet een voorblad met enkel tekst
        eerste = next((i for i, b in enumerate(lijst) if b.get("bruikbaar", True)), 0)
        self.keuze_bron.setCurrentIndex(eerste)
        self.keuze_bron.setEnabled(len(lijst) > 1)
        self.keuze_bron.blockSignals(False)
        if len(lijst) > 1:
            self.log(f"{len(lijst)} bronnen in dit bestand - kies er een bij 'Bron'.")
        self.start_analyse()

    # -------------------------------------------------- analyse

    def start_analyse(self):
        if not self.bestand:
            return
        self.knop_omzetten.setEnabled(False)
        self.statusBar().showMessage("Bezig met inlezen en vectoriseren...")
        self.log(f"\n--- {os.path.basename(self.bestand)}")
        werker = self._start_werker(analyseer, self.bestand, self.huidige_opties(),
                                    met_voortgang=True)
        werker.klaar.connect(self._analyse_klaar)
        werker.mislukt.connect(self._analyse_mislukt)
        werker.voortgang.connect(
            lambda tekst: self.statusBar().showMessage(f"Bezig: {tekst}..."))
        werker.start()

    def _analyse_mislukt(self, sporen: str):
        self.statusBar().showMessage("Inlezen mislukt.")
        self.log(sporen.strip().splitlines()[-1])
        QMessageBox.critical(self, TITEL, "Dit bestand kon niet verwerkt worden:\n\n"
                             + sporen.strip().splitlines()[-1])

    def _analyse_klaar(self, analyse: Analyse):
        self.analyse = analyse
        self.kalibratiepunten = []
        self.voorbeeld.zet_analyse(analyse)
        soort = {"vector-pdf": "vector-PDF (exacte geometrie)",
                 "scan-pdf": "ingescande PDF (gevectoriseerd)",
                 "afbeelding-pdf": "geplakte afbeelding in een PDF (gevectoriseerd)",
                 "foto": "foto (rechtgetrokken en gevectoriseerd)"}.get(analyse.route,
                                                                         analyse.route)
        self.log(f"Herkend als: {soort}")
        for melding in analyse.meldingen:
            self.log(f"  · {melding}")

        self.keuze_schaal.blockSignals(True)
        self.keuze_schaal.clear()
        for kandidaat in analyse.kandidaten:
            self.keuze_schaal.addItem(str(kandidaat), kandidaat)
        if not analyse.kandidaten:
            self.keuze_schaal.addItem("geen schaal gevonden - duid twee punten aan", None)
        self.keuze_schaal.blockSignals(False)
        self.keuze_schaal.setCurrentIndex(0)
        self._schaal_gewijzigd(0)

        self.knop_omzetten.setEnabled(bool(analyse.kandidaten))
        self.statusBar().showMessage(
            f"{analyse.tekening.aantal_segmenten()} lijnstukken gevonden.")

    # -------------------------------------------------- schaal

    def huidige_schaal(self) -> Optional[SchaalKandidaat]:
        return self.keuze_schaal.currentData()

    ZEKER_GENOEG = 0.75

    def _schaal_gewijzigd(self, _index: int):
        kandidaat = self.huidige_schaal()
        self.voorbeeld.schaalnoemer = kandidaat.noemer if kandidaat is not None else None
        if kandidaat is None:
            self.label_uitleg.setText("Duid twee punten aan met een gekende maat, "
                                      "of geef de schaal zelf in.")
            self.label_uitleg.setStyleSheet("color:#9aa0a6;")
            self.knop_omzetten.setEnabled(False)
            return

        if kandidaat.vertrouwen < self.ZEKER_GENOEG:
            # Een schaal waar de tool zelf niet zeker van is, mag er niet
            # uitzien als een gewone uitkomst: alle maten in de DXF hangen
            # ervan af, en een fout van een factor twee ziet er in CAD
            # volkomen normaal uit.
            self.label_uitleg.setText(
                "ONZEKER - controleer dit voor je de DXF gebruikt.\n"
                + kandidaat.toelichting
                + "\n\nDuid liever twee punten aan met een maat die je kent.")
            self.label_uitleg.setStyleSheet("color:#ffb454; font-weight:bold;")
        else:
            self.label_uitleg.setText(kandidaat.toelichting)
            self.label_uitleg.setStyleSheet("color:#9aa0a6;")
        self.knop_omzetten.setEnabled(True)

    def start_kalibratie(self):
        if self.analyse is None:
            return
        self.kalibratiepunten = []
        self.voorbeeld.start_kalibratie()
        self.statusBar().showMessage(
            "Klik het eerste punt aan van een maat die je kent - zoom in voor precisie. "
            "Gele markering = vastgeklikt op de tekening.")

    def _punt_verwijderd(self):
        if self.kalibratiepunten:
            self.kalibratiepunten.pop()
        self.statusBar().showMessage("Klik het eerste punt aan van een maat die je kent.")

    def _punt_gekozen(self, x_mm: float, y_mm: float):
        self.kalibratiepunten.append((x_mm, y_mm))
        if len(self.kalibratiepunten) == 1:
            self.statusBar().showMessage("Klik nu het tweede punt aan.")
            return

        (x1, y1), (x2, y2) = self.kalibratiepunten[:2]
        papier = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        self.voorbeeld.stop_kalibratie()
        if papier < 0.5:
            QMessageBox.information(self, TITEL, "Die twee punten liggen te dicht bij elkaar.")
            return
        # voorinvullen met wat de huidige schaal ervan maakt: klopt dat al
        # ongeveer, dan hoef je enkel de juiste maat te verbeteren
        huidige = self.huidige_schaal()
        voorstel = round(papier * huidige.noemer / 10) * 10 if huidige else 3000.0
        voorstel = min(max(voorstel, 1.0), 1_000_000.0)
        papier_tekst = f"{papier:.2f}".replace(".", ",")
        waarde, ok = QInputDialog.getDouble(
            self, TITEL,
            f"Je duidde {papier_tekst} mm op het blad aan.\n"
            "Hoeveel millimeter is dat in werkelijkheid?",
            float(voorstel), 1.0, 1_000_000.0, 0)
        if not ok:
            self.statusBar().showMessage("Kalibratie geannuleerd.")
            return
        kandidaat = schaal_uit_kalibratie(papier, waarde)
        self.keuze_schaal.insertItem(0, str(kandidaat), kandidaat)
        self.keuze_schaal.setCurrentIndex(0)
        self.log(f"Gekalibreerd: {kandidaat.toelichting}")

    def schaal_ingeven(self):
        tekst, ok = QInputDialog.getText(self, TITEL,
                                         "Geef de schaal in, bijvoorbeeld 50 voor 1/50:")
        if not ok or not tekst.strip():
            return
        # "1:50", "1/50" en "50" moeten alle drie 50 opleveren. Tekens
        # wegstrippen werkt hier niet: dan wordt van "100" de leidende 1
        # afgehaald en houd je 00 over.
        schoon = re.sub(r"^\s*1\s*[:/]\s*", "", tekst.strip()).replace(",", ".")
        try:
            noemer = float(schoon)
        except ValueError:
            QMessageBox.warning(self, TITEL,
                                f'"{tekst.strip()}" kan ik niet lezen als schaal. '
                                "Geef bijvoorbeeld 50 of 1:50 in.")
            return
        if noemer <= 0:
            return
        kandidaat = SchaalKandidaat(noemer=noemer, methode="handmatig", vertrouwen=1.0,
                                    standaardnoemer=noemer,
                                    toelichting="schaal handmatig ingegeven")
        self.keuze_schaal.insertItem(0, str(kandidaat), kandidaat)
        self.keuze_schaal.setCurrentIndex(0)

    # -------------------------------------------------- omzetten

    def omzetten(self):
        if self.analyse is None:
            return
        kandidaat = self.huidige_schaal()
        if kandidaat is None:
            QMessageBox.information(self, TITEL, "Kies eerst een schaal.")
            return
        opties = self.huidige_opties()
        self.knop_omzetten.setEnabled(False)
        self.statusBar().showMessage("Bezig met wegschrijven...")
        werker = self._start_werker(converteer, self.analyse, kandidaat.noemer, opties)
        werker.klaar.connect(self._omzetten_klaar)
        werker.mislukt.connect(self._analyse_mislukt)
        werker.start()

    def _omzetten_klaar(self, resultaat: dict):
        self.knop_omzetten.setEnabled(True)
        self.log(f"DXF geschreven: {resultaat['pad']}")
        self.log(f"  {resultaat['polylijnen']} lijnobjecten, {resultaat['teksten']} teksten, "
                 f"schaal {resultaat['schaal']}, "
                 f"tekening {resultaat['breedte_mm'] / 1000:.2f} x "
                 f"{resultaat['hoogte_mm'] / 1000:.2f} m")
        if resultaat.get("dwg"):
            self.log(f"DWG geschreven: {resultaat['dwg']}")
        for waarschuwing in resultaat.get("waarschuwingen", []):
            self.log(f"Let op: {waarschuwing}")
        self.statusBar().showMessage("Klaar.")
        QMessageBox.information(
            self, TITEL,
            "Klaar.\n\n" + os.path.basename(resultaat["pad"]) +
            (f"\n{os.path.basename(resultaat['dwg'])}" if resultaat.get("dwg") else "") +
            f"\n\nOpgeslagen naast het originele bestand, in millimeter op ware grootte.")


def start():
    app = QApplication(sys.argv)
    app.setApplicationName("Plan2CAD")
    venster = Hoofdvenster()
    venster.show()
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        venster.open_bestand(sys.argv[1])
    sys.exit(app.exec())


if __name__ == "__main__":
    start()
