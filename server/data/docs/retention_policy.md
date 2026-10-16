# Data Retention Policy (GOV-DR-001)

Owner: Data Governance Office. Applies to every system: ERP, POS, CRM, SIS, HRIS and Support.
Effective: January 2026. Review cycle: annual.

## 1. Purpose
This policy sets how long we keep records, when we delete or anonymise them, and who
approves exceptions. It supports privacy law compliance and keeps storage costs down.

## 2. Retention periods

| Record type | System | Keep for | Then |
|---|---|---|---|
| Customer records (contacts, leads, deals) | CRM | 5 years after last activity | Anonymise |
| Lost leads with no activity | CRM | 2 years after creation | Delete |
| Financial records (invoices, purchase orders, orders) | ERP | 7 years after fiscal year end | Archive, then delete |
| POS transactions | POS | 7 years | Archive, then delete |
| Card payment data | POS | Never stored beyond the last 4 digits | n/a |
| Student academic records (grades, transcripts) | SIS | Permanently | Restricted archive after graduation |
| Student contact and parent/guardian details | SIS / CRM | 3 years after the student leaves | Delete |
| Employee records | HRIS | 6 years after employment ends | Delete |
| Payroll records | HRIS | 7 years | Archive, then delete |
| Support tickets | Support | 3 years after closure | Anonymise |
| Uploaded images (receipts, IDs, forms) | Any | 90 days after the data is extracted into a record | Delete |

## 3. Customer records in detail
Customer personal data (name, email, phone) is kept only while there is an active
relationship plus 5 years. After that, the record is anonymised: name and contact details
are removed, and transaction totals stay for reporting. Customers may ask for earlier
deletion (a "right to erasure" request). The Data Governance Office must complete it
within 30 days, unless financial-record rules require us to keep the data.

## 4. Legal hold
If litigation or an audit is expected, the Legal team can place a legal hold. Records
under hold are never deleted, whatever the retention period.

## 5. Responsibilities
- System owners run the deletion and anonymisation jobs quarterly.
- The Data Governance Office audits compliance twice a year.
- Exceptions need written approval from the Data Protection Officer.
