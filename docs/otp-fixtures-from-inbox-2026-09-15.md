# Anonymized OTP fixtures from live Messages (2026-09-15)

Use these to expand `lib/otp.js` + `lib/test-sms.js`. Digits shown as placeholders.

## Should detect as verification / Copy Code

1. `Your Tinder code is 482913 @tinder.com 482913`
2. `Votre code de vérification OpenAI est : 366017`
3. `839201 is your Link verification code.`
4. `Votre code de vérification 3Deval est : 366017`
5. `Amazon: Your code is 482913. Don't share it.`
6. `Info Free : votre code est 239159. Ne le communiquez pas.`
7. `Pour signer votre contrat, veuillez saisir le code 4829.`
8. `Authorize a login. Use code: 123-456. Never share it.`
9. `Use 482913 for two-factor authentication on your account.`

## Must NOT detect (false positive guard)

10. `Le montant cumulé de vos dépenses du mois sur vos comptes [ACCOUNT], [ACCOUNT] et [ACCOUNT] a dépassé l'objectif de 500,00 EUR.`

## Notes

- Tinder / OpenAI / 3Deval / Amazon / Free (FR) / Link / 2FA English / bank authorize with hyphenated code.
- French bank “saisir le code ####” (4 digits) for contract signing.
- Expense-threshold SMS must stay ordinary notification (no Copy Code).
