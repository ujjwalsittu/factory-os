#!/usr/bin/env bash
# Imports checks (decisions 026–028): foreign-currency PO, receipt at the PO exchange rate, landed cost voucher, guarded cancels.
# Usage: API=http://localhost:4000 apps/api/scripts/smoke-imports.sh
set -euo pipefail
B="${API:-http://localhost:4000}/api"
ORIGIN="${WEB_ORIGIN:-http://localhost:3000}"
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
run=$RANDOM$RANDOM
H=(-H 'Content-Type: application/json' -H "Origin: $ORIGIN")
SCOPE=()
req() { local m=$1 p=$2 body=${3:-}; local args=(-s -o "$dir/out" -w '%{http_code}' -b "$dir/jar" -c "$dir/jar" -X "$m" "${H[@]}" "${SCOPE[@]}"); [ -n "$body" ] && args+=(-d "$body"); local code; code=$(curl "${args[@]}" "$B$p"); echo "$code $(cat "$dir/out")"; }
expect() { local got=${3%% *}; if [ "$got" = "$2" ]; then echo "✓ $1"; else echo "✗ $1: wanted $2 got $3" >&2; exit 1; fi; }
field() { python3 -c "import sys,json;d=json.loads(sys.argv[1].split(' ',1)[1]);print(eval(sys.argv[2]))" "$1" "$2"; }
check() { if [ "$2" = "$3" ]; then echo "✓ $1 ($3)"; else echo "✗ $1: wanted $3 got $2" >&2; exit 1; fi; }
gstin() { node -e "const C='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',f=process.argv[1];let s=0;for(let i=0;i<14;i++){const p=C.indexOf(f[i])*(i%2?2:1);s+=Math.floor(p/36)+p%36}console.log(f+C[(36-s%36)%36])" "$1"; }
# receive <date> <supplier> <po> <lines> → submit response of a receipt against the PO
receive() {
  local r; r=$(req POST /stock-entries "{\"purpose\":\"receipt\",\"postingDate\":\"$1\",\"partyId\":\"$2\",\"purchaseOrderId\":\"$3\",\"reference\":\"DC-$RANDOM\",\"lines\":$4}")
  [ "${r%% *}" = 201 ] || { echo "$r"; return; }
  req POST "/stock-entries/$(field "$r" "d['id']")/submit"
}
post() { local r; r=$(req POST /stock-entries "$1"); [ "${r%% *}" = 201 ] || { echo "$r"; return; }; req POST "/stock-entries/$(field "$r" "d['id']")/submit"; }
val() { field "$(req GET "/stock/balance?itemId=$1")" "'%.2f' % sum(float(x['value']) for x in d)"; }

expect "sign up" 200 "$(req POST /auth/sign-up/email "{\"email\":\"imp$run@example.com\",\"password\":\"Sup3r-secret-pw\",\"name\":\"Imports Lead\"}")"
r=$(req POST /tenants '{"name":"Imports","entity":{"legalName":"Azeonics Private Limited","shortName":"Azeonics","code":"AZ","pan":"AAACA1234B"}}')
T=$(field "$r" "d['tenant']['id']"); E=$(field "$r" "d['entity']['id']")
SCOPE=(-H "x-tenant-id: $T" -H "x-entity-id: $E")
KG=$(field "$(req GET /uoms)" "[u['id'] for u in d if u['code']=='KG'][0]")
NOS=$(field "$(req GET /uoms)" "[u['id'] for u in d if u['code']=='NOS'][0]")
req POST /warehouses/standard >/dev/null
STORES=$(field "$(req GET /warehouses)" "[w['id'] for w in d if w['code']=='STORES'][0]")
req POST /entities/$E/gst-registrations "{\"gstin\":\"$(gstin 27AAACA1234B1Z)\"}" >/dev/null
req POST /hsn-codes '{"code":"81089090","kind":"hsn","description":"Titanium, other","gstRate":"18","effectiveFrom":"2025-04-01"}' >/dev/null
TI=$(field "$(req POST /items "{\"code\":\"TI64-BAR\",\"name\":\"Ti-6Al-4V bar\",\"type\":\"raw_material\",\"tracking\":\"batch\",\"stockUomId\":\"$KG\",\"hsnCode\":\"81089090\"}")" "d['id']")
SC=$(field "$(req POST /items "{\"code\":\"M6-SCREW\",\"name\":\"M6 Ti screw\",\"type\":\"component\",\"stockUomId\":\"$NOS\"}")" "d['id']")
r=$(req POST /parties '{"code":"BAOJI","name":"Baoji Titanium Co","isSupplier":true,"gstTreatment":"overseas"}')
expect "overseas supplier" 201 "$r"; OVS=$(field "$r" "d['id']")
LOC=$(field "$(req POST /parties "{\"code\":\"MIDH\",\"name\":\"Mishra Metals\",\"isSupplier\":true,\"gstin\":\"$(gstin 27AAACM1234B1Z)\"}")" "d['id']")
CHA=$(field "$(req POST /parties "{\"code\":\"CHA1\",\"name\":\"Nhava Sheva Clearing\",\"isSupplier\":true,\"gstin\":\"$(gstin 27AAACN1234B1Z)\"}")" "d['id']")

# ── Foreign currency purchase order (decision 026) ──
L2="[{\"itemId\":\"$TI\",\"qty\":\"100\",\"rate\":\"25\"},{\"itemId\":\"$SC\",\"qty\":\"1000\",\"rate\":\"0.5\",\"gstRate\":\"18\"}]"
expect "Indian supplier can't be billed in USD" 400 "$(req POST /purchase-orders "{\"supplierId\":\"$LOC\",\"orderDate\":\"2026-10-01\",\"currency\":\"USD\",\"exchangeRate\":\"80\",\"lines\":$L2}")"
expect "USD needs an exchange rate" 400 "$(req POST /purchase-orders "{\"supplierId\":\"$OVS\",\"orderDate\":\"2026-10-01\",\"currency\":\"USD\",\"lines\":$L2}")"
r=$(req POST /purchase-orders "{\"supplierId\":\"$OVS\",\"orderDate\":\"2026-10-01\",\"currency\":\"usd\",\"exchangeRate\":\"80\",\"lines\":$L2}")
expect "USD purchase order at ₹80" 201 "$r"; PO=$(field "$r" "d['id']")
check "import PO: no GST on the supplier's side, totals in USD" "$(field "$r" "(d['currency'],d['exchangeRate'],d['taxableValue'],d['totalTax'],d['grandTotal'])")" "('USD', '80.000000', '3000.00', '0.00', '3000.00')"
expect "submit" 201 "$(req POST /purchase-orders/$PO/submit)"
r=$(req GET /purchase-orders/$PO); TIL=$(field "$r" "d['lines'][0]['id']"); SCL=$(field "$r" "d['lines'][1]['id']")
r=$(post "{\"purpose\":\"receipt\",\"postingDate\":\"2026-10-02\",\"partyId\":\"$OVS\",\"purchaseOrderId\":\"$PO\",\"reference\":\"BL-7781\",\"lines\":[{\"itemId\":\"$TI\",\"qty\":\"100\",\"toWarehouseId\":\"$STORES\",\"newBatchNo\":\"HT-IMP-1\",\"poLineId\":\"$TIL\"},{\"itemId\":\"$SC\",\"qty\":\"1000\",\"toWarehouseId\":\"$STORES\",\"poLineId\":\"$SCL\"}]}")
expect "receive the shipment" 201 "$r"; GRN=$(field "$r" "d['id']")
check "valued in INR at the PO rate (25 × 80, 0.5 × 80)" "$(field "$(req GET /stock-entries/$GRN)" "[(l['rate'],l['value']) for l in d['lines']]")" "[('2000.000000', '200000.000000'), ('40.000000', '40000.000000')]"
r=$(post "{\"purpose\":\"issue\",\"postingDate\":\"2026-10-03\",\"reference\":\"WO-1\",\"lines\":[{\"itemId\":\"$TI\",\"qty\":\"40\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$(field "$(req GET "/batches?itemId=$TI&inStock=true")" "d[0]['id']")\"}]}")
expect "issue 40 kg before the duty bill arrives" 201 "$r"; ISS1=$(field "$r" "d['id']")
TIB=$(field "$(req GET "/batches?itemId=$TI&inStock=true")" "d[0]['id']")

# ── Purchase invoice in USD ──
expect "invoice must use the PO currency" 400 "$(req POST /purchase-invoices "{\"supplierId\":\"$OVS\",\"purchaseOrderId\":\"$PO\",\"supplierInvoiceNo\":\"BJ-2026-118\",\"supplierInvoiceDate\":\"2026-10-01\",\"postingDate\":\"2026-10-02\",\"lines\":[{\"itemId\":\"$TI\",\"poLineId\":\"$TIL\",\"qty\":\"100\",\"rate\":\"25\"}]}")"
r=$(req POST /purchase-invoices "{\"supplierId\":\"$OVS\",\"purchaseOrderId\":\"$PO\",\"currency\":\"USD\",\"exchangeRate\":\"83.25\",\"supplierInvoiceNo\":\"BJ-2026-118\",\"supplierInvoiceDate\":\"2026-10-01\",\"postingDate\":\"2026-10-02\",\"lines\":[{\"itemId\":\"$TI\",\"poLineId\":\"$TIL\",\"qty\":\"100\",\"rate\":\"25\"},{\"itemId\":\"$SC\",\"poLineId\":\"$SCL\",\"qty\":\"1000\",\"rate\":\"0.5\",\"gstRate\":\"18\"}]}")
expect "USD invoice at its own rate" 201 "$r"
r=$(req POST /purchase-invoices/$(field "$r" "d['id']")/submit)
check "submitted, no GST charged by an overseas supplier" "$(field "$r" "(d['currency'],d['exchangeRate'],d['grandTotal'],d['igst'],d['reverseCharge'])")" "('USD', '83.250000', '3000.00', '0.00', False)"

# ── Landed cost voucher (decisions 027, 028) ──
LCV() { echo "{\"postingDate\":\"$1\",\"boeNo\":\"4417823\",\"boeDate\":\"${3:-2026-10-03}\",\"portCode\":\"INNSA1\",\"customsExchangeRate\":\"80.10\",\"assessableValue\":\"240000\",\"importIgst\":\"48600\",\"receiptIds\":[\"$GRN\"],\"charges\":$2}"; }
CH="[{\"chargeType\":\"bcd\",\"amount\":\"24000\",\"documentNo\":\"BOE 4417823\"},{\"chargeType\":\"sws\",\"amount\":\"2400\"},{\"chargeType\":\"clearing\",\"amount\":\"3600\",\"partyId\":\"$CHA\",\"documentNo\":\"NSC/889\"}]"
expect "freight by weight refused when an item isn't stocked by weight" 400 "$(req POST /landed-costs/preview "$(LCV 2026-10-04 "[{\"chargeType\":\"freight\",\"amount\":\"6000\",\"basis\":\"weight\"}]")")"
expect "charges must be positive" 400 "$(req POST /landed-costs/preview "$(LCV 2026-10-04 "[{\"chargeType\":\"freight\",\"amount\":\"0\"}]")")"
r=$(req POST /landed-costs/preview "$(LCV 2026-10-04 "$CH")")
check "preview by value: 5 : 1" "$(field "$r" "[(x['itemCode'],x['charges'],x['total']) for x in d]")" "[('TI64-BAR', ['20000.00', '2000.00', '3000.00'], '25000.00'), ('M6-SCREW', ['4000.00', '400.00', '600.00'], '5000.00')]"
r=$(req POST /landed-costs/preview "$(LCV 2026-10-04 "[{\"chargeType\":\"freight\",\"amount\":\"100\",\"basis\":\"qty\"}]")")
check "by quantity, rounding remainder on the last line" "$(field "$r" "[x['total'] for x in d]")" "['9.09', '90.91']"
r=$(req POST /landed-costs "$(LCV 2026-10-01 "$CH" 2026-10-01)")
expect "draft voucher" 201 "$r"; V=$(field "$r" "d['id']")
expect "posting before the receipt refused" 400 "$(req POST /landed-costs/$V/submit)"
expect "move it to after the issue" 200 "$(req PUT /landed-costs/$V "$(LCV 2026-10-04 "$CH")")"
r=$(req POST /landed-costs/$V/submit)
expect "submit landed cost" 201 "$r"
check "on hand vs already issued" "$(field "$r" "(d['number'],d['totalCharges'],d['onHandValue'],d['varianceValue'])")" "('AZ/LCV/26-27/00001', '30000.00', '20000.00', '10000.00')"
check "Ti on hand: 60 kg at 2250" "$(val $TI)" "135000.00"
check "screws: 1000 at 45" "$(val $SC)" "45000.00"
r=$(req GET /landed-costs/$V)
check "stored allocation with layer change" "$(field "$r" "[(x['itemCode'],x['newRate'],x['onHandValue'],x['varianceValue']) for x in d['allocation']]")" "[('TI64-BAR', '2250.000000', '15000.000000', '10000.000000'), ('M6-SCREW', '45.000000', '5000.000000', '0.000000')]"
check "ledger carries the value-only row" "$(field "$(req GET "/stock/ledger?itemId=$TI")" "[(x['voucherType'],x['qty'],x['value']) for x in d if x['voucherType']=='landed_cost']")" "[('landed_cost', '0.000000', '15000.000000')]"
expect "receipt covered by landed cost can't be cancelled" 409 "$(req POST /stock-entries/$GRN/cancel '{"reason":"wrong shipment"}')"
expect "issue made before the landed cost can't be cancelled" 409 "$(req POST /stock-entries/$ISS1/cancel '{"reason":"wrong work order"}')"
r=$(post "{\"purpose\":\"issue\",\"postingDate\":\"2026-10-05\",\"reference\":\"WO-2\",\"lines\":[{\"itemId\":\"$TI\",\"qty\":\"10\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$TIB\"}]}")
expect "issue 10 kg after landed cost" 201 "$r"; ISS2=$(field "$r" "d['id']")
check "issued at the landed rate" "$(field "$(req GET /stock-entries/$ISS2)" "d['lines'][0]['value']")" "22500.000000"
expect "voucher can't be cancelled once its stock moved" 409 "$(req POST /landed-costs/$V/cancel '{"reason":"duty reassessed"}')"
expect "the later issue can be cancelled" 201 "$(req POST /stock-entries/$ISS2/cancel '{"reason":"wrong work order"}')"
expect "now the voucher cancels exactly" 201 "$(req POST /landed-costs/$V/cancel '{"reason":"duty reassessed"}')"
check "Ti back to 60 kg at 2000" "$(val $TI)" "120000.00"
check "ledger reversal" "$(field "$(req GET "/stock/ledger?itemId=$TI")" "sum(float(x['value']) for x in d if x['voucherType']=='landed_cost')")" "0.0"
expect "and the early issue too" 201 "$(req POST /stock-entries/$ISS1/cancel '{"reason":"wrong work order"}')"
check "Ti 100 kg at 2000" "$(val $TI)" "200000.00"
r=$(req GET /landed-costs)
check "voucher list" "$(field "$r" "[(x['status'],x['boeNo'],x['receipts']) for x in d]")" "[('cancelled', '4417823', 'AZ/SE/26-27/00001')]"
expect "candidate receipts" 200 "$(req GET /landed-costs/receipts)"
echo "All imports checks passed."
