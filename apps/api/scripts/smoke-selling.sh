#!/usr/bin/env bash
# Selling checks (slice 1c, decisions 029–032): quotation → sales order → invoice that ships the goods, LUT exports, credit warnings, series.
# Usage: API=http://localhost:4000 apps/api/scripts/smoke-selling.sh
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
bal() { field "$(req GET "/stock/balance?itemId=$1")" "'%g' % sum(float(x['qty']) for x in d)"; }

expect "sign up" 200 "$(req POST /auth/sign-up/email "{\"email\":\"sell$run@example.com\",\"password\":\"Sup3r-secret-pw\",\"name\":\"Sales Head\"}")"
r=$(req POST /tenants '{"name":"Selling","entity":{"legalName":"Azeonics Private Limited","shortName":"Azeonics","code":"AZ","pan":"AAACA1234B"}}')
T=$(field "$r" "d['tenant']['id']"); E=$(field "$r" "d['entity']['id']")
SCOPE=(-H "x-tenant-id: $T" -H "x-entity-id: $E")
NOS=$(field "$(req GET /uoms)" "[u['id'] for u in d if u['code']=='NOS'][0]")
HR=$(field "$(req GET /uoms)" "[u['id'] for u in d if u['code']=='HR'][0]")
req POST /warehouses/standard >/dev/null
FG=$(field "$(req GET /warehouses)" "[w['id'] for w in d if w['code']=='FG'][0]")
r=$(req POST /entities/$E/gst-registrations "{\"gstin\":\"$(gstin 27AAACA1234B1Z)\"}"); REG=$(field "$r" "d['id']")
req POST /hsn-codes '{"code":"88073000","kind":"hsn","description":"Parts of aircraft","gstRate":"18","effectiveFrom":"2025-04-01"}' >/dev/null
req POST /hsn-codes '{"code":"998898","kind":"sac","description":"Other manufacturing services","gstRate":"18","effectiveFrom":"2025-04-01"}' >/dev/null
BRK=$(field "$(req POST /items "{\"code\":\"AZ-BRK-C\",\"name\":\"Bracket, rev C\",\"type\":\"finished_good\",\"tracking\":\"batch\",\"stockUomId\":\"$NOS\",\"hsnCode\":\"88073000\"}")" "d['id']")
MAAS=$(field "$(req POST /items "{\"code\":\"MAAS-5AX\",\"name\":\"5-axis machining, per hour\",\"type\":\"service\",\"stockUomId\":\"$HR\",\"hsnCode\":\"998898\"}")" "d['id']")
ADDR='[{"label":"Works","line1":"Plot 12, GIDC","city":"Pune","stateCode":"27","pincode":"411019"}]'
SKY=$(field "$(req POST /parties "{\"code\":\"SKYR\",\"name\":\"Skyroot Aerospace\",\"isCustomer\":true,\"gstin\":\"$(gstin 27AAACS1234B1Z)\",\"creditDays\":30,\"creditLimit\":\"200000\",\"addresses\":$ADDR}")" "d['id']")
BLX=$(field "$(req POST /parties "{\"code\":\"BLTX\",\"name\":\"Bellatrix Aerospace\",\"isCustomer\":true,\"gstin\":\"$(gstin 29AAACB1234B1Z)\",\"creditLimit\":\"10000\"}")" "d['id']")
AIR=$(field "$(req POST /parties '{"code":"AIRB","name":"Airbus Defence and Space","isCustomer":true,"gstTreatment":"overseas","creditDays":60}')" "d['id']")
expect "make 20 brackets (receipt into FG)" 201 "$(post "{\"purpose\":\"receipt\",\"postingDate\":\"2026-10-01\",\"reference\":\"WO-7\",\"lines\":[{\"itemId\":\"$BRK\",\"qty\":\"20\",\"toWarehouseId\":\"$FG\",\"newBatchNo\":\"LOT-1\",\"rate\":\"3000\"}]}")"
LOT=$(field "$(req GET "/batches?itemId=$BRK&inStock=true")" "d[0]['id']")

# ── Tax on outward supplies ──
P() { echo "{\"customerId\":\"$1\",\"date\":\"2026-10-02\"${3:+,$3},\"lines\":[{\"itemId\":\"$BRK\",\"qty\":\"$2\",\"rate\":\"5000\"}]}"; }
check "Maharashtra customer: CGST + SGST" "$(field "$(req POST /selling/tax-preview "$(P $SKY 10)")" "(d['kind'],d['cgst'],d['sgst'],d['invoiceTotal'],d['placeOfSupplyStateCode'])")" "('intra', '4500.00', '4500.00', '59000.00', '27')"
check "Karnataka customer: IGST" "$(field "$(req POST /selling/tax-preview "$(P $BLX 10)")" "(d['kind'],d['igst'])")" "('inter', '9000.00')"
expect "export under LUT needs a LUT on file" 400 "$(req POST /selling/tax-preview "$(P $AIR 2 '"currency":"USD","exchangeRate":"84"')")"
expect "record the LUT on our GSTIN" 200 "$(req PATCH /gst-registrations/$REG '{"lutArn":"AD270326001234X","lutValidFrom":"2026-04-01","lutValidTo":"2027-03-31"}')"
r=$(req POST /selling/tax-preview "{\"customerId\":\"$AIR\",\"date\":\"2026-10-02\",\"currency\":\"USD\",\"exchangeRate\":\"84\",\"lines\":[{\"itemId\":\"$BRK\",\"qty\":\"2\",\"rate\":\"60\"}]}")
check "export: zero-rated, LUT quoted" "$(field "$r" "(d['kind'],d['igst'],d['invoiceTotal'],d['supplyType'],d['placeOfSupplyStateCode'],d['lutArn'])")" "('zero_rated', '0.00', '120.00', 'export_under_lut', '96', 'AD270326001234X')"
expect "an overseas customer isn't a regular supply" 400 "$(req POST /selling/tax-preview "$(P $AIR 2 '"supplyType":"regular"')")"
expect "domestic customers are billed in INR" 400 "$(req POST /selling/tax-preview "$(P $SKY 2 '"currency":"USD","exchangeRate":"84"')")"

# ── Quotation → sales order ──
L="[{\"itemId\":\"$BRK\",\"qty\":\"10\",\"rate\":\"5000\"},{\"itemId\":\"$MAAS\",\"qty\":\"8\",\"rate\":\"3500\",\"description\":\"Mazak Variaxis, fixture trial\"}]"
r=$(req POST /quotations "{\"customerId\":\"$SKY\",\"quotationDate\":\"2026-10-02\",\"validTill\":\"2026-10-31\",\"customerRef\":\"SKY/RFQ/88\",\"lines\":$L}")
expect "quotation" 201 "$r"; Q=$(field "$r" "d['id']")
check "quotation totals (goods + machining hours)" "$(field "$r" "(d['taxableValue'],d['totalTax'],d['grandTotal'])")" "('78000.00', '14040.00', '92040.00')"
expect "can't order a draft quotation" 409 "$(req POST /quotations/$Q/order '{}')"
check "submit quotation" "$(field "$(req POST /quotations/$Q/submit)" "d['number']")" "AZ/QTN/26-27/0001"
r=$(req POST /quotations/$Q/order '{"customerPoNo":"SKY/PO/4471","customerPoDate":"2026-10-02"}')
expect "customer accepts: order from quotation" 201 "$r"; SO=$(field "$r" "d['id']")
expect "quotation can be ordered only once" 409 "$(req POST /quotations/$Q/order '{}')"
r=$(req POST /sales-orders/$SO/submit)
expect "submit sales order (within credit)" 201 "$r"
check "order numbered" "$(field "$r" "(d['number'],d['customerPoNo'])")" "('AZ/SO/26-27/0001', 'SKY/PO/4471')"
r=$(req GET /sales-orders/$SO); SOB=$(field "$r" "d['lines'][0]['id']"); SOM=$(field "$r" "d['lines'][1]['id']")
check "order links its quotation" "$(field "$r" "d['quotationNumber']")" "AZ/QTN/26-27/0001"

# ── Invoice ships the goods (decision 030) ──
INV() { echo "{\"customerId\":\"$SKY\",\"salesOrderId\":\"$SO\",\"invoiceDate\":\"$1\",\"lines\":$2}"; }
r=$(req POST /sales-invoices "$(INV 2026-10-03 "[{\"itemId\":\"$BRK\",\"soLineId\":\"$SOB\",\"qty\":\"6\",\"rate\":\"5000\"},{\"itemId\":\"$MAAS\",\"soLineId\":\"$SOM\",\"qty\":\"8\",\"rate\":\"3500\"}]")")
expect "draft invoice from the order" 201 "$r"; I1=$(field "$r" "d['id']")
check "snapshot of customer and address, due in 30 days" "$(field "$r" "(d['customerName'],d['billingAddress']['city'],d['dueDate'])")" "('Skyroot Aerospace', 'Pune', '2026-11-02')"
expect "batch-tracked goods need a batch to ship" 400 "$(req POST /sales-invoices/$I1/submit)"
expect "pick the lot" 200 "$(req PUT /sales-invoices/$I1 "$(INV 2026-10-03 "[{\"itemId\":\"$BRK\",\"soLineId\":\"$SOB\",\"qty\":\"6\",\"rate\":\"5000\",\"batchId\":\"$LOT\"},{\"itemId\":\"$MAAS\",\"soLineId\":\"$SOM\",\"qty\":\"8\",\"rate\":\"3500\"}]")")"
r=$(req POST /sales-invoices/$I1/submit)
expect "submit tax invoice" 201 "$r"
check "number ≤ 16 chars, GST" "$(field "$r" "(d['number'],len(d['number']),d['cgst'],d['sgst'],d['grandTotal'])")" "('AZ/26-27/00001', 14, '5220.00', '5220.00', '68440.00')"
check "goods left FG" "$(bal $BRK)" "14"
r=$(req GET /sales-invoices/$I1); DEL=$(field "$r" "d['stockEntryId']")
check "delivery entry posted at FIFO cost" "$(field "$(req GET /stock-entries/$DEL)" "(d['purpose'],d['systemGenerated'],d['lines'][0]['value'])")" "('delivery', True, '18000.000000')"
expect "the delivery can't be cancelled on its own" 409 "$(req POST /stock-entries/$DEL/cancel '{"reason":"wrong lot shipped"}')"
expect "can't invoice more than ordered" 400 "$(req POST /sales-invoices/$(field "$(req POST /sales-invoices "$(INV 2026-10-03 "[{\"itemId\":\"$BRK\",\"soLineId\":\"$SOB\",\"qty\":\"5\",\"rate\":\"5000\",\"batchId\":\"$LOT\"}]")")" "d['id']")/submit)"
expect "order with invoices can't be cancelled" 409 "$(req POST /sales-orders/$SO/cancel '{"reason":"customer withdrew"}')"
expect "future-dated tax invoice refused" 400 "$(req POST /sales-invoices/$(field "$(req POST /sales-invoices "{\"customerId\":\"$SKY\",\"invoiceDate\":\"2099-01-01\",\"lines\":[{\"itemId\":\"$MAAS\",\"qty\":\"1\",\"rate\":\"3500\"}]}")" "d['id']")/submit)"

# ── Number series continue from Tally (decision 029) ──
r=$(req GET /number-series)
check "series list shows the next tax invoice" "$(field "$r" "[x['nextNumber'] for x in d if x['label']=='Tax invoice']")" "['AZ/26-27/00002']"
expect "continue after Tally's last invoice (41)" 200 "$(req PUT /number-series "{\"docType\":\"sales_invoice:$REG\",\"fy\":\"26-27\",\"nextValue\":42}")"
expect "series never moves back" 400 "$(req PUT /number-series "{\"docType\":\"sales_invoice:$REG\",\"fy\":\"26-27\",\"nextValue\":10}")"
r=$(req POST /sales-invoices "{\"customerId\":\"$SKY\",\"invoiceDate\":\"2026-10-04\",\"lines\":[{\"itemId\":\"$MAAS\",\"qty\":\"2\",\"rate\":\"3500\"}]}")
r=$(req POST /sales-invoices/$(field "$r" "d['id']")/submit)
check "services-only invoice: next number, no stock movement" "$(field "$r" "(d['number'],d['stockEntryId'])")" "('AZ/26-27/00042', None)"

# ── Credit warnings (decision 032) ──
BI() { req POST /sales-invoices "{\"customerId\":\"$BLX\",\"invoiceDate\":\"2026-10-04\",\"lines\":[{\"itemId\":\"$BRK\",\"qty\":\"1\",\"rate\":\"5000\",\"batchId\":\"$LOT\"}]}"; }
expect "first Bellatrix invoice within ₹10,000" 201 "$(req POST /sales-invoices/$(field "$(BI)" "d['id']")/submit)"
B2=$(field "$(BI)" "d['id']")
r=$(req POST /sales-invoices/$B2/submit)
expect "second would cross the limit: warning" 400 "$r"
check "warning explains the limit" "$(field "$r" "'would be at ₹11800.00 against a credit limit of ₹10000.00' in d['message']")" "True"
r=$(req POST /sales-invoices/$B2/submit '{"acceptCreditWarning":true}')
expect "approver overrides" 201 "$r"
check "override recorded" "$(field "$r" "(d['creditOverride'],d['igst'])")" "(True, '900.00')"
check "credit status" "$(field "$(req GET "/selling/credit-status?customerId=$BLX")" "(d['outstanding'],d['creditLimit'])")" "('11800.00', '10000.00')"

# ── Export under LUT (decision 031) ──
EX() { echo "{\"customerId\":\"$AIR\",\"invoiceDate\":\"2026-10-05\",\"currency\":\"USD\",\"exchangeRate\":\"84.1\",\"shippingBillNo\":\"7712345\",\"shippingBillDate\":\"$1\",\"portCode\":\"INBOM4\",\"lines\":[{\"itemId\":\"$BRK\",\"qty\":\"2\",\"rate\":\"60\",\"batchId\":\"$LOT\"}]}"; }
expect "shipping bill can't predate the invoice" 400 "$(req POST /sales-invoices "$(EX 2026-10-01)")"
r=$(req POST /sales-invoices "$(EX 2026-10-06)")
expect "export invoice in USD" 201 "$r"
r=$(req POST /sales-invoices/$(field "$r" "d['id']")/submit)
check "zero-rated, LUT on the invoice" "$(field "$r" "(d['currency'],d['supplyType'],d['igst'],d['grandTotal'],d['lutArn'],d['number'])")" "('USD', 'export_under_lut', '0.00', '120.00', 'AD270326001234X', 'AZ/26-27/00045')"

# ── Cancel restores stock and the order ──
expect "cancel the first invoice" 201 "$(req POST /sales-invoices/$I1/cancel '{"reason":"wrong rate agreed"}')"
check "brackets back in FG" "$(bal $BRK)" "16"
check "order quantity free again" "$(field "$(req GET /sales-orders/$SO)" "[l['pendingQty'] for l in d['lines']]")" "['10.000000', '8.000000']"
expect "close the order" 201 "$(req POST /sales-orders/$SO/close '{"reason":"customer re-quoting"}')"
check "invoice list" "$(field "$(req GET '/sales-invoices?status=submitted')" "sorted(x['number'] for x in d)")" "['AZ/26-27/00042', 'AZ/26-27/00043', 'AZ/26-27/00044', 'AZ/26-27/00045']"
echo "All selling checks passed."
