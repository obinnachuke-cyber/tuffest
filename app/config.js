/* TUFFEST settings. Fill these in once, then host the folder: every phone that opens the
   site picks them up, so nobody pastes keys on each device.
   These two Supabase values are meant to be public (your data is protected by the login and
   the row-level rules in supabase-setup.sql). Leave them empty to run in local-only mode. */
window.TUFFEST_CONFIG = {
  supabaseUrl: 'https://gdtbicmbuvjijeamyiwu.supabase.co',      // Supabase dashboard -> Project Settings -> API -> Project URL   (https://xxxx.supabase.co)
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkdGJpY21idXZqaWplYW15aXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMDM4NTYsImV4cCI6MjExMDY3OTg1Nn0.U-xgZ0ZzM-B1FAPe18X0GV44y36Tswfw2Q_FkUQyLMQ',  // same page -> Project API keys -> "anon" "public"
  mapsKey: '',          // optional: Google Maps key (restrict it to your site address)
};
