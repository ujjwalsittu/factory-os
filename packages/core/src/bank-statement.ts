import { Dec } from './decimal.js';
import { bankDate, bankMoney } from './bank-reconciliation-common.js';
import type { CsvMapping, NormalizedStatement, StatementParseInput } from './bank-reconciliation-types.js';

/** RFC4180 records, with original record ordinals (embedded newlines are fields). */
function tokenize(csv: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const finishField = () => { row.push(field); field = ''; closed = false; };
  const finishRow = () => { finishField(); records.push(row); row = []; };
  const source = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === delimiter) finishField();
    else if (c === '\r' || c === '\n') { if (c === '\r' && source[i + 1] === '\n') i++; finishRow(); }
    else if (c === '"' && !field && !closed) quoted = true;
    else { if (c === '"' || closed) throw new Error('Malformed CSV quotes'); field += c; }
  }
  if (quoted) throw new Error('Unterminated CSV quotes');
  if (field || closed || row.length) finishRow();
  return records;
}
function sourceMoney(value: string, mapping: CsvMapping): Dec {
  let text = value.trim();
  const [whole, fraction, ...extra] = text.split(mapping.decimalSeparator);
  if (extra.length) throw new Error('Invalid decimal separators');
  let integer = whole!;
  if (mapping.groupSeparator && integer.includes(mapping.groupSeparator)) {
    const escaped = mapping.groupSeparator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^-?\\d{1,3}(?:${escaped}\\d{3})+$`).test(integer)) throw new Error('Invalid grouping');
    integer = integer.split(mapping.groupSeparator).join('');
  }
  text = integer + (fraction === undefined ? '' : `.${fraction}`);
  return bankMoney(text);
}
function sourceDate(value: string, mapping: CsvMapping): string {
  if (mapping.dateFormat === 'YYYY-MM-DD') return bankDate(value);
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!parts) throw new Error('Invalid mapped date');
  return bankDate(`${parts[3]}-${mapping.dateFormat === 'DD/MM/YYYY' ? parts[2] : parts[1]}-${mapping.dateFormat === 'DD/MM/YYYY' ? parts[1] : parts[2]}`);
}
export function parseBankStatement(input: StatementParseInput, mapping: CsvMapping): NormalizedStatement {
  const result: NormalizedStatement = { rows: [], errors: [], ignoredOrdinals: [], netAmount: Dec.ZERO.toString() };
  try {
    bankDate(input.startDate); bankDate(input.endDate);
    if (input.startDate > input.endDate) throw new Error('Invalid statement interval');
    const opening = bankMoney(input.openingBalance), closing = bankMoney(input.closingBalance);
    if (mapping.delimiter.length !== 1 || /["\r\n]/.test(mapping.delimiter) || !Number.isSafeInteger(mapping.skipRows) || mapping.skipRows < 0 || mapping.groupSeparator === mapping.decimalSeparator) throw new Error('Invalid CSV mapping');
    const records = tokenize(input.csv, mapping.delimiter);
    const header = records[mapping.skipRows];
    if (!header || new Set(header).size !== header.length) throw new Error('Missing or duplicate CSV headers');
    const columns = [mapping.dateColumn, mapping.referenceColumn, mapping.descriptionColumn, mapping.runningBalanceColumn, mapping.transactionIdColumn, mapping.balanceRow?.column, ...(mapping.amount.mode === 'split' ? [mapping.amount.debitColumn, mapping.amount.creditColumn] : [mapping.amount.column])].filter((x): x is string => x !== undefined);
    if (columns.some(x => !header.includes(x))) throw new Error('Mapped CSV column missing');
    const data = records.slice(mapping.skipRows + 1);
    if (data.length > 10000) throw new Error('Statement exceeds 10000 row limit');
    for (const [index, fields] of data.entries()) {
      const ordinal = mapping.skipRows + index + 2;
      try {
        if (fields.length !== header.length) throw new Error('CSV column count differs from header');
        const get = (column: string) => fields[header.indexOf(column)]!;
        if (mapping.balanceRow && get(mapping.balanceRow.column) === mapping.balanceRow.value) { result.ignoredOrdinals.push(ordinal); continue; }
        const date = sourceDate(get(mapping.dateColumn).trim(), mapping);
        if (date < input.startDate || date > input.endDate) throw new Error('Date outside statement interval');
        let amount: Dec;
        if (mapping.amount.mode === 'split') {
          const debit = sourceMoney(get(mapping.amount.debitColumn).trim() || '0', mapping), credit = sourceMoney(get(mapping.amount.creditColumn).trim() || '0', mapping);
          if (debit.isNeg() || credit.isNeg() || (!debit.isZero() && !credit.isZero())) throw new Error('Invalid debit/credit sides');
          amount = credit.sub(debit);
        } else {
          amount = sourceMoney(get(mapping.amount.column), mapping);
          if (mapping.amount.polarity === 'debit-positive') amount = amount.neg();
        }
        if (amount.isZero()) throw new Error('Zero bank movement');
        result.rows.push({ date, signedAmount: amount.toString(), ordinal, reference: mapping.referenceColumn ? get(mapping.referenceColumn) : '', description: mapping.descriptionColumn ? get(mapping.descriptionColumn) : '', ...(mapping.transactionIdColumn && get(mapping.transactionIdColumn).trim() ? { transactionId: get(mapping.transactionIdColumn).trim() } : {}), ...(mapping.runningBalanceColumn ? { runningBalance: sourceMoney(get(mapping.runningBalanceColumn), mapping).toString() } : {}) });
      } catch (error) { result.errors.push({ ordinal, message: (error as Error).message }); }
    }
    if (mapping.order === 'descending') result.rows.reverse();
    let balance = opening, previous = input.startDate;
    for (const row of result.rows) {
      if (row.date < previous) result.errors.push({ ordinal: row.ordinal, message: 'Date order differs from mapping' });
      previous = row.date; balance = balance.add(row.signedAmount);
      if (row.runningBalance !== undefined && !balance.eq(row.runningBalance)) result.errors.push({ ordinal: row.ordinal, message: 'Running balance differs from movements' });
    }
    result.netAmount = balance.sub(opening).toString();
    if (!balance.eq(closing)) result.errors.push({ message: 'Closing balance differs from opening plus movements' });
  } catch (error) { result.errors.push({ message: (error as Error).message }); }
  return result;
}
