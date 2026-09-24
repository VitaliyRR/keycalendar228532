-- Existing checkin_time is the earliest arrival time; checkout_time is the
-- latest departure time. NULL in a new column preserves a legacy single
-- reference time without claiming that the other window boundary is known.
ALTER TABLE properties
  ADD COLUMN checkin_time_end time,
  ADD COLUMN checkout_time_start time,
  ADD CONSTRAINT properties_checkin_window_order
    CHECK (checkin_time_end IS NULL OR checkin_time_end > checkin_time),
  ADD CONSTRAINT properties_checkout_window_order
    CHECK (checkout_time_start IS NULL OR checkout_time_start < checkout_time);
