-- Shows exactly which order(s) on Sept 16 and Sept 17 are CANCELLED —
-- these are the orders your raw query counted but the app (correctly)
-- doesn't, which is the entire ₹1,837 gap (₹557 on the 16th + ₹1,280 on
-- the 17th) between your query's totals and what the admin portal shows.
SELECT
    id,
    DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS order_date,
    created_at AT TIME ZONE 'Asia/Kolkata' AS created_at_ist,
    status,
    total,
    table_number,
    source
FROM orders
WHERE restaurant_id = 'd9261f86-a6e4-45c9-9c29-d0a8f6dbea24'
  AND status = 'CANCELLED'
  AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') IN ('2026-09-16', '2026-09-17')
ORDER BY created_at DESC;

-- Expect: the totals on 2026-09-16 sum to ~557.00, and on 2026-09-17
-- sum to ~1280.00. If they do, this fully explains the mismatch and
-- confirms the app's numbers (not the raw query) are the correct ones
-- to trust for real revenue.
