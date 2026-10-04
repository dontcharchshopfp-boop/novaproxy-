# NovaProxy fix

This build disables Helmet's Content-Security-Policy because the current UI uses inline button handlers (`onclick`) in the public/admin pages. Without this, actions such as login and balance lookup can appear clickable but their inline handlers are blocked by the browser.

All existing proxy, Supabase, balance, API-key and admin functionality is preserved.
