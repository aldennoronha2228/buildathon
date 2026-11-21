# SaudaSakshi Feature Guide

SaudaSakshi turns verbal work agreements into structured records, supports party confirmation, and tracks advance and balance payments.

## Workflow

- Enter a transcript manually or use Sarvam speech transcription when configured.
- Extract agreement terms, review and edit them, then record contractor and customer confirmations.
- Agreement extraction requires Sarvam LLM; invalid or incomplete extraction is rejected without creating a record.
- Create real Cashfree payment links when Cashfree credentials and the customer's phone number are available. Payment status is confirmed through gateway polling or a signed webhook.
- Track unpaid balances through alarms, reminders, and agreement history.

## Settings

Business profile and agreement records are stored in SQLite. Integration badges show whether Sarvam and Cashfree are connected. Unconfigured integrations return errors; the app does not create sample records, infer missing payment amounts, or simulate payments.

## Stack

- React, Vite, Tailwind CSS, and React Router
- Node.js, Express, and SQLite
- Sarvam AI for speech transcription and term extraction
- Cashfree for payment links and settlement confirmation

See [README.md](README.md) for setup and configuration.
