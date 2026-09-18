-- Confirms whether the ~₹1,837 gap between the app's MTD figure and the
-- raw query is explained by CANCELLED orders (which the app deliberately
-- excludes from revenue everywhere, but the earlier query didn't filter).
SELECT
    DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS order_date,
    status,
    SUM(total) AS cancelled_total
FROM orders
WHERE restaurant_id = 'd9261f86-a6e4-45c9-9c29-d0a8f6dbea24'
  AND status = 'CANCELLED'
  AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') BETWEEN '2026-09-01' AND '2026-09-18'
GROUP BY 1, 2
ORDER BY 1 DESC;

-- If this sums to ~1837.00 across one or more days, that fully explains
-- the gap and there's nothing wrong with the app's numbers.
