-- Milestone 3: first-sign-in account bootstrap.
--
-- accounts_insert_self can create the owner row, but account_members_insert_self
-- checks that the account exists via a subquery on accounts. That subquery is
-- subject to RLS. Before this policy, a brand-new owner could not SELECT the
-- account they just inserted because accounts_select_member requires membership
-- that does not exist yet. Membership insert then failed closed and the HTTP
-- upload path never bound the session to an account.
--
-- Additive only. Does not rewrite Fix #5–#8 history.

drop policy if exists accounts_select_owner on accounts;
create policy accounts_select_owner on accounts
  for select using (account_owner_user_id = auth.uid());
