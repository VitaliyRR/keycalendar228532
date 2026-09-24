-- Every posted entry must have at least two lines with equal debit and credit.
-- Deferred checking lets the API insert an entry and its lines in one transaction.
CREATE OR REPLACE FUNCTION public.assert_journal_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  target_org uuid;
  target_entry uuid;
  line_count bigint;
  debit_total numeric;
  credit_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target_org := NEW.organization_id;
    target_entry := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target_org := OLD.organization_id;
    target_entry := OLD.entry_id;
  ELSE
    target_org := NEW.organization_id;
    target_entry := NEW.entry_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE organization_id=target_org AND id=target_entry) THEN
    RETURN NULL;
  END IF;
  SELECT count(*),COALESCE(sum(debit_minor),0),COALESCE(sum(credit_minor),0)
    INTO line_count,debit_total,credit_total FROM public.journal_lines
    WHERE organization_id=target_org AND entry_id=target_entry;
  IF line_count<2 OR debit_total<>credit_total THEN
    RAISE EXCEPTION 'Unbalanced journal entry %',target_entry USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER journal_entry_balance
AFTER INSERT OR UPDATE ON public.journal_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_journal_balance();

CREATE CONSTRAINT TRIGGER journal_line_balance
AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_journal_balance();
