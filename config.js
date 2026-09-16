// BROS Planbord — koppeling met de database (Supabase, project "BROS planbord").
// Deze twee waarden zijn publiek en mogen in dit bestand staan; de service_role-/secret-sleutel NOOIT.
window.PLANBORD_CONFIG = {
  supabaseUrl: "https://xsgpqpwrgpnmfupuitaq.supabase.co",
  supabaseAnonKey: "sb_publishable_gPModXFtfryEkrXEZzAyAg_9Qtieiux",
  // Web app-URL van het Drive-script (publiek; het secret staat enkel in Instellingen). Het klantenportaal gebruikt dit voor "wachtwoord vergeten" (mail via Gmail).
  driveScriptUrl: "https://script.google.com/macros/s/AKfycbxb_4OgWksay-4h1fLb-W8L11icFAf-HMnsRL983_ZbayS-o5-svd_TGrFMCjA1zKnH/exec",
};
