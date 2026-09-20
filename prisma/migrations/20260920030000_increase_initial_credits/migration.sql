-- Bring existing users to the 15,000,000-credit signup allocation.
INSERT INTO "CreditLedger" (
    "id",
    "userId",
    "amount",
    "type",
    "referenceType",
    "referenceId",
    "idempotencyKey",
    "createdAt"
)
SELECT
    md5(random()::text || clock_timestamp()::text || user_record."id"),
    user_record."id",
    CASE
        WHEN legacy_grant."id" IS NOT NULL THEN 14000000
        ELSE 15000000
    END,
    'GRANT',
    'User',
    user_record."id",
    'initial-credit-grant-v2:' || user_record."id",
    CURRENT_TIMESTAMP
FROM "User" AS user_record
LEFT JOIN "CreditLedger" AS legacy_grant
    ON legacy_grant."idempotencyKey" = 'initial-credit-grant:' || user_record."id"
WHERE NOT EXISTS (
    SELECT 1
    FROM "CreditLedger" AS current_grant
    WHERE current_grant."idempotencyKey" = 'initial-credit-grant-v2:' || user_record."id"
);
