# Anvaya v3 Rich Chat — Fixed 14

This release keeps the Fixed 13 application and chat behavior intact. The only functional change is the complete account-deletion SQL repair.

## Database
Run `supabase_account_deletion_fix.sql` once in Supabase SQL Editor. Do not rerun `supabase_schema.sql`.

The deletion function removes the account's application data and owned Anvaya storage files, then deletes the Supabase Auth identity. Creating a new account with the same email therefore creates a fresh Auth user/profile with a new user id and no prior account data.
