#!/usr/bin/env bash
# Buying checks (slice 1b): PO → receipt into quarantine → incoming inspection → purchase invoice, against a running API.
# Usage: API=http://localhost:4000 apps/api/scripts/smoke-buying.sh
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
bal() { field "$(req GET "/stock/balance?itemId=$1")" "str(sum(float(x['qty']) for x in d if x['warehouseCode']=='$2'))"; }

expect "sign up" 200 "$(req POST /auth/sign-up/email "{\"email\":\"buy$run@example.com\",\"password\":\"Sup3r-secret-pw\",\"name\":\"Purchase Head\"}")"
r=$(req POST /tenants '{"name":"Buying","entity":{"legalName":"Azeonics Private Limited","shortName":"Azeonics","code":"AZ","pan":"AAACA1234B"}}')
T=$(field "$r" "d['tenant']['id']"); E=$(field "$r" "d['entity']['id']")
SCOPE=(-H "x-tenant-id: $T" -H "x-entity-id: $E")
KG=$(field "$(req GET /uoms)" "[u['id'] for u in d if u['code']=='KG'][0]")
NOS=$(field "$(req GET /uoms)" "[u['id'] for u in d if u['code']=='NOS'][0]")
req POST /warehouses/standard >/dev/null
wh() { field "$(req GET /warehouses)" "[w['id'] for w in d if w['code']=='$1'][0]"; }
QUAR=$(wh QUAR); STORES=$(wh STORES)

TI=$(field "$(req POST /items "{\"code\":\"TI64-BAR\",\"name\":\"Ti-6Al-4V bar\",\"type\":\"raw_material\",\"tracking\":\"batch\",\"stockUomId\":\"$KG\",\"hsnCode\":\"81089090\",\"requiresIncomingInspection\":true}")" "d['id']")
SC=$(field "$(req POST /items "{\"code\":\"M6-SCREW\",\"name\":\"M6 SS screw\",\"type\":\"consumable\",\"stockUomId\":\"$NOS\"}")" "d['id']")
SUP=$(field "$(req POST /parties "{\"code\":\"MIDH\",\"name\":\"Mishra Metals\",\"isSupplier\":true,\"gstin\":\"$(gstin 27AAACM1234B1Z)\",\"msmeCategory\":\"micro\",\"creditDays\":60}")" "d['id']")
KAR=$(field "$(req POST /parties "{\"code\":\"BLRF\",\"name\":\"Bengaluru Fasteners\",\"isSupplier\":true,\"gstin\":\"$(gstin 29AAACB1234B1Z)\",\"creditDays\":30}")" "d['id']")
CUS=$(field "$(req POST /parties "{\"code\":\"SKYR\",\"name\":\"Skyroot Aerospace\",\"isCustomer\":true,\"gstin\":\"$(gstin 36AAACS1234B1Z)\"}")" "d['id']")

expect "PO needs our GSTIN first" 400 "$(req POST /purchase-orders "{\"supplierId\":\"$SUP\",\"orderDate\":\"2026-10-01\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"1\",\"rate\":\"1\",\"gstRate\":\"18\"}]}")"
expect "add our GSTIN (Maharashtra)" 201 "$(req POST /entities/$E/gst-registrations "{\"gstin\":\"$(gstin 27AAACA1234B1Z)\"}")"
expect "rate from HSN needs the HSN on file" 400 "$(req POST /buying/tax-preview "{\"supplierId\":\"$SUP\",\"date\":\"2026-10-01\",\"lines\":[{\"itemId\":\"$TI\",\"qty\":\"1\",\"rate\":\"1\"}]}")"
expect "HSN 81089090 @ 18%" 201 "$(req POST /hsn-codes '{"code":"81089090","kind":"hsn","description":"Titanium, other","gstRate":"18","effectiveFrom":"2025-04-01"}')"
expect "a customer is not a supplier" 400 "$(req POST /buying/tax-preview "{\"supplierId\":\"$CUS\",\"date\":\"2026-10-01\",\"lines\":[]}")"
r=$(req POST /buying/tax-preview "{\"supplierId\":\"$SUP\",\"date\":\"2026-10-01\",\"lines\":[{\"itemId\":\"$TI\",\"qty\":\"10\",\"rate\":\"1000\"}]}")
check "intra-state preview: CGST+SGST" "$(field "$r" "(d['cgst'],d['sgst'],d['igst'],d['invoiceTotal'],d['gstRates'])")" "('900.00', '900.00', '0.00', '11800.00', ['18'])"
r=$(req POST /buying/tax-preview "{\"supplierId\":\"$KAR\",\"date\":\"2026-10-01\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"100\",\"rate\":\"2.5\",\"gstRate\":\"18\"}]}")
check "inter-state preview: IGST" "$(field "$r" "(d['igst'],d['cgst'])")" "('45.00', '0.00')"
expect "item without HSN needs a GST rate" 400 "$(req POST /purchase-orders "{\"supplierId\":\"$SUP\",\"orderDate\":\"2026-10-01\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"1\",\"rate\":\"1\"}]}")"

# ── Purchase order ──
r=$(req POST /purchase-orders "{\"supplierId\":\"$SUP\",\"orderDate\":\"2026-10-01\",\"supplierQuoteRef\":\"MM/Q/77\",\"lines\":[{\"itemId\":\"$TI\",\"qty\":\"100\",\"rate\":\"1000\"},{\"itemId\":\"$SC\",\"qty\":\"500\",\"rate\":\"2\",\"gstRate\":\"18\"}]}")
expect "draft PO" 201 "$r"; PO=$(field "$r" "d['id']")
check "PO totals" "$(field "$r" "(d['taxableValue'],d['totalTax'],d['grandTotal'],d['paymentTermsDays'])")" "('101000.00', '18180.00', '119180.00', 60)"
expect "edit draft PO" 200 "$(req PUT /purchase-orders/$PO "{\"supplierId\":\"$SUP\",\"orderDate\":\"2026-10-01\",\"lines\":[{\"itemId\":\"$TI\",\"qty\":\"100\",\"rate\":\"1000\"},{\"itemId\":\"$SC\",\"qty\":\"400\",\"rate\":\"2\",\"gstRate\":\"18\"}]}")"
expect "can't receive against a draft PO" 400 "$(receive 2026-10-02 "$SUP" "$PO" "[{\"itemId\":\"$TI\",\"qty\":\"1\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"X\",\"poLineId\":\"00000000-0000-4000-8000-000000000000\"}]")"
r=$(req POST /purchase-orders/$PO/submit)
expect "submit PO" 201 "$r"
check "PO numbered in its FY" "$(field "$r" "d['number']")" "AZ/PO/26-27/0001"
expect "submitted PO is immutable" 409 "$(req PUT /purchase-orders/$PO "{\"supplierId\":\"$SUP\",\"orderDate\":\"2026-10-01\",\"lines\":[{\"itemId\":\"$TI\",\"qty\":\"1\",\"rate\":\"1\"}]}")"
r=$(req GET /purchase-orders/$PO)
TIL=$(field "$r" "d['lines'][0]['id']"); SCL=$(field "$r" "d['lines'][1]['id']")
check "PO line pending" "$(field "$r" "d['lines'][0]['pendingQty']")" "100.000000"

# ── Receipt against the PO ──
expect "over-receipt refused" 400 "$(receive 2026-10-02 "$SUP" "$PO" "[{\"itemId\":\"$TI\",\"qty\":\"120\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"HT-1\",\"poLineId\":\"$TIL\"}]")"
expect "another supplier can't deliver this PO" 400 "$(receive 2026-10-02 "$KAR" "$PO" "[{\"itemId\":\"$TI\",\"qty\":\"10\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"HT-1\",\"poLineId\":\"$TIL\"}]")"
r=$(receive 2026-10-02 "$SUP" "$PO" "[{\"itemId\":\"$TI\",\"qty\":\"60\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"HT-1\",\"poLineId\":\"$TIL\"},{\"itemId\":\"$SC\",\"qty\":\"400\",\"toWarehouseId\":\"$STORES\",\"poLineId\":\"$SCL\"}]")
expect "receive 60 kg Ti into quarantine + 400 screws" 201 "$r"; GRN1=$(field "$r" "d['id']")
r=$(req GET /stock-entries/$GRN1)
check "PO rate fills the receipt value" "$(field "$r" "d['lines'][0]['value']")" "60000.000000"
check "received qty on the PO" "$(field "$(req GET /purchase-orders/$PO)" "[l['receivedQty'] for l in d['lines']]")" "['60.000000', '400.000000']"

# ── Incoming inspection ──
r=$(req GET /inspections/pending)
check "quarantine queue shows only the Ti line" "$(field "$r" "[(x['itemCode'],x['batchNo'],x['pending']) for x in d]")" "[('TI64-BAR', 'HT-1', '60.000000')]"
RL=$(field "$r" "d[0]['receiptLineId']")
expect "can't inspect more than pending" 400 "$(req POST /inspections "{\"receiptLineId\":\"$RL\",\"inspectionDate\":\"2026-10-03\",\"qtyAccepted\":\"60\",\"qtyRejected\":\"5\"}")"
r=$(req POST /inspections "{\"receiptLineId\":\"$RL\",\"inspectionDate\":\"2026-10-03\",\"qtyAccepted\":\"50\",\"qtyRejected\":\"5\",\"checks\":\"MTC verified; UT ok\"}")
expect "inspect 55: accept 50, reject 5" 201 "$r"; QI=$(field "$r" "d['id']"); TR=$(field "$r" "d['transferEntryId']")
check "partial result, numbered" "$(field "$r" "(d['result'],d['number'])")" "('partial', 'AZ/QI/26-27/00001')"
check "stores 50 / MRB 5 / quarantine 5" "$(bal $TI STORES)/$(bal $TI MRB)/$(bal $TI QUAR)" "50.0/5.0/5.0"
check "5 kg still pending" "$(field "$(req GET /inspections/pending)" "[x['pending'] for x in d]")" "['5.000000']"
expect "inspected receipt can't be cancelled" 409 "$(req POST /stock-entries/$GRN1/cancel '{"reason":"wrong supplier"}')"
expect "inspection transfer can't be cancelled directly" 409 "$(req POST /stock-entries/$TR/cancel '{"reason":"undo the move"}')"
expect "cancel the inspection" 201 "$(req POST /inspections/$QI/cancel '{"reason":"wrong quantities"}')"
check "all 60 back in quarantine" "$(bal $TI STORES)/$(bal $TI MRB)/$(bal $TI QUAR)" "0/0/60.0"
expect "re-inspect: accept all 60" 201 "$(req POST /inspections "{\"receiptLineId\":\"$RL\",\"inspectionDate\":\"2026-10-03\",\"qtyAccepted\":\"60\",\"qtyRejected\":\"0\"}")"
check "60 kg in stores, worth 60000" "$(field "$(req GET "/stock/balance?itemId=$TI")" "[(x['warehouseCode'],x['qty'],x['value']) for x in d]")" "[('STORES', '60.000000', '60000.00')]"
check "inspection log" "$(field "$(req GET /inspections)" "[(x['status'],x['result']) for x in d]")" "[('submitted', 'accepted'), ('cancelled', 'partial')]"

# ── Purchase invoice ──
INV() { echo "{\"supplierId\":\"$SUP\",\"purchaseOrderId\":\"$PO\",\"supplierInvoiceNo\":\"$1\",\"supplierInvoiceDate\":\"2026-10-04\",\"postingDate\":\"2026-10-05\",\"lines\":$2}"; }
expect "a PO with receipts can't be cancelled" 409 "$(req POST /purchase-orders/$PO/cancel '{"reason":"no longer needed"}')"
r=$(req POST /purchase-invoices "$(INV mm/26/101 "[{\"itemId\":\"$TI\",\"poLineId\":\"$TIL\",\"qty\":\"70\",\"rate\":\"1000\"}]")")
expect "draft invoice for 70 kg" 201 "$r"; PI=$(field "$r" "d['id']")
expect "3-way match: only 60 received" 400 "$(req POST /purchase-invoices/$PI/submit)"
r=$(req PUT /purchase-invoices/$PI "$(INV mm/26/101 "[{\"itemId\":\"$TI\",\"poLineId\":\"$TIL\",\"qty\":\"60\",\"rate\":\"1000\"},{\"itemId\":\"$SC\",\"poLineId\":\"$SCL\",\"qty\":\"400\",\"rate\":\"2\",\"gstRate\":\"18\"}]")")
expect "correct the draft to 60 kg + 400 screws" 200 "$r"
r=$(req POST /purchase-invoices/$PI/submit)
expect "submit invoice" 201 "$r"
check "invoice GST, MSME due date capped at 45 days" "$(field "$r" "(d['number'],d['supplierInvoiceNo'],d['cgst'],d['sgst'],d['igst'],d['grandTotal'],d['dueDate'])")" "('AZ/PI/26-27/00001', 'MM/26/101', '5472.00', '5472.00', '0.00', '71744.00', '2026-11-18')"
r=$(req POST /purchase-invoices "{\"supplierId\":\"$SUP\",\"supplierInvoiceNo\":\"MM/26/101\",\"supplierInvoiceDate\":\"2026-10-04\",\"postingDate\":\"2026-10-05\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"1\",\"rate\":\"2\",\"gstRate\":\"18\"}]}")
expect "duplicate supplier invoice is drafted" 201 "$r"; DUP=$(field "$r" "d['id']")
expect "…but can't be booked twice" 409 "$(req POST /purchase-invoices/$DUP/submit)"
expect "drafts can be deleted" 200 "$(req DELETE /purchase-invoices/$DUP)"

r=$(receive 2026-10-06 "$SUP" "$PO" "[{\"itemId\":\"$TI\",\"qty\":\"20\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"HT-2\",\"poLineId\":\"$TIL\"}]")
expect "second delivery: 20 kg" 201 "$r"; GRN2=$(field "$r" "d['id']")
r=$(req POST /purchase-invoices "$(INV MM/26/130 "[{\"itemId\":\"$TI\",\"poLineId\":\"$TIL\",\"qty\":\"20\",\"rate\":\"1050\"}]")")
PI2=$(field "$r" "d['id']")
expect "rate variance vs PO needs confirmation" 400 "$(req POST /purchase-invoices/$PI2/submit)"
expect "submit with variance confirmed" 201 "$(req POST /purchase-invoices/$PI2/submit '{"acceptRateVariance":true}')"
check "PO fully received and billed" "$(field "$(req GET /purchase-orders/$PO)" "[(l['pendingQty'],l['unbilledQty']) for l in d['lines']]")" "[('20.000000', '0.000000'), ('0.000000', '0.000000')]"
expect "invoiced receipt can't be cancelled" 409 "$(req POST /stock-entries/$GRN2/cancel '{"reason":"wrong heat"}')"
expect "cancel the second invoice" 201 "$(req POST /purchase-invoices/$PI2/cancel '{"reason":"supplier sent a revised invoice"}')"
expect "now the receipt can be cancelled" 201 "$(req POST /stock-entries/$GRN2/cancel '{"reason":"wrong heat"}')"
check "PO quantities restored" "$(field "$(req GET /purchase-orders/$PO)" "(d['lines'][0]['receivedQty'],d['lines'][0]['billedQty'])")" "('60.000000', '60.000000')"
r=$(req POST /purchase-invoices "$(INV MM/26/131 "[{\"itemId\":\"$TI\",\"poLineId\":\"$TIL\",\"qty\":\"1\",\"rate\":\"1000\"}]")")
expect "nothing left to bill on the PO" 400 "$(req POST /purchase-invoices/$(field "$r" "d['id']")/submit)"

r=$(req POST /purchase-invoices "{\"supplierId\":\"$KAR\",\"supplierInvoiceNo\":\"BF-9001\",\"supplierInvoiceDate\":\"2026-10-05\",\"postingDate\":\"2026-10-05\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"100\",\"rate\":\"2.5\",\"gstRate\":\"18\"}]}")
expect "invoice without PO from Karnataka" 201 "$r"
r=$(req POST /purchase-invoices/$(field "$r" "d['id']")/submit)
check "inter-state: IGST, due in supplier's 30 days" "$(field "$r" "(d['igst'],d['cgst'],d['grandTotal'],d['dueDate'])")" "('45.00', '0.00', '295.00', '2026-11-04')"
expect "invoice date after posting date refused" 400 "$(req POST /purchase-invoices "{\"supplierId\":\"$KAR\",\"supplierInvoiceNo\":\"BF-9002\",\"supplierInvoiceDate\":\"2026-10-09\",\"postingDate\":\"2026-10-05\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"1\",\"rate\":\"1\",\"gstRate\":\"18\"}]}")"

expect "short-close the PO" 201 "$(req POST /purchase-orders/$PO/close '{"reason":"balance 20 kg not needed"}')"
expect "closed PO takes no more receipts" 400 "$(receive 2026-10-07 "$SUP" "$PO" "[{\"itemId\":\"$TI\",\"qty\":\"5\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"HT-3\",\"poLineId\":\"$TIL\"}]")"
check "open-PO filter excludes it" "$(field "$(req GET '/purchase-orders?open=true')" "len(d)")" "0"
r=$(req POST /purchase-orders "{\"supplierId\":\"$KAR\",\"orderDate\":\"2026-10-07\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"10\",\"rate\":\"2\",\"gstRate\":\"18\"}]}")
expect "draft POs can be deleted" 200 "$(req DELETE /purchase-orders/$(field "$r" "d['id']"))"
echo "All buying checks passed."
