export interface CsvMapping {
  delimiter: string;
  skipRows: number;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  dateColumn: string;
  referenceColumn?: string;
  descriptionColumn?: string;
  amount: { mode: 'split'; debitColumn: string; creditColumn: string } | { mode: 'signed'; column: string; polarity: 'credit-positive' | 'debit-positive' };
  decimalSeparator: '.' | ',';
  groupSeparator: '.' | ',' | ' ' | null;
  order: 'ascending' | 'descending';
  transactionIdColumn?: string;
  runningBalanceColumn?: string;
  balanceRow?: { column: string; value: string };
}
export interface StatementParseInput { csv: string; startDate: string; endDate: string; openingBalance: string; closingBalance: string }
export interface StatementItem { id: string; date: string; signedAmount: string; reference: string }
export interface BookItem extends StatementItem { kind: 'gl' | 'opening' }
export interface NormalizedStatementRow { date: string; signedAmount: string; reference: string; description: string; ordinal: number; transactionId?: string; runningBalance?: string }
export interface NormalizedStatement { rows: NormalizedStatementRow[]; errors: { ordinal?: number; message: string }[]; ignoredOrdinals: number[]; netAmount: string }
export interface MatchEdge { statementRowId: string; bookItemId: string; bookItemKind: BookItem['kind']; amount: string }
export interface OrdinaryMatchInput { kind: 'ordinary'; edges: MatchEdge[] }
export interface NetMatchInput { kind: 'net'; statementRowIds: string[]; bankEntryId: string; source: { principal: string; charge: string }; reason: string }
export type ResolvedMatch = { kind: 'ordinary'; edges: (MatchEdge & { effectiveDate: string })[] } | (NetMatchInput & { effectiveDate: string });
export interface ReconciliationInput {
  asOf: string;
  baseline: { date: string; bookBalance: string; bankBalance: string; outstanding: BookItem[] };
  book: BookItem[];
  statement: StatementItem[];
  matches: ResolvedMatch[];
  coverageComplete: boolean;
}
export interface BankReportArithmetic {
  B: string; U: string; E: string; S: string; difference: string; coverageComplete: boolean;
  bookResiduals: (BookItem & { remaining: string })[];
  statementResiduals: (StatementItem & { remaining: string })[];
}
