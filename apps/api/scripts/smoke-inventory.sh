#!/usr/bin/env bash
# End-to-end checks for Phase 1a inventory against a running API (fresh tenant each run).
# Usage: API=http://localhost:4000 apps/api/scripts/smoke-inventory.sh
set -euo pipefail
B="${API:-http://localhost:4000}/api"
ORIGIN="${WEB_ORIGIN:-http://localhost:3000}"
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
run=$RANDOM$RANDOM
H=(-H 'Content-Type: application/json' -H "Origin: $ORIGIN")
SCOPE=()

req() { # req <method> <path> [body] → "status body"
  local m=$1 p=$2 body=${3:-}
  local args=(-s -o "$dir/out" -w '%{http_code}' -b "$dir/jar" -c "$dir/jar" -X "$m" "${H[@]}" "${SCOPE[@]}")
  [ -n "$body" ] && args+=(-d "$body")
  local code; code=$(curl "${args[@]}" "$B$p"); echo "$code $(cat "$dir/out")"
}
expect() { local got=${3%% *}; if [ "$got" = "$2" ]; then echo "✓ $1"; else echo "✗ $1: wanted $2 got $3" >&2; exit 1; fi; }
field() { python3 -c "import sys,json;d=json.loads(sys.argv[1].split(' ',1)[1]);print(eval(sys.argv[2]))" "$1" "$2"; }
check() { if [ "$2" = "$3" ]; then echo "✓ $1 ($3)"; else echo "✗ $1: wanted $3 got $2" >&2; exit 1; fi; }
gstin() { node -e "const C='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',f=process.argv[1];let s=0;for(let i=0;i<14;i++){const p=C.indexOf(f[i])*(i%2?2:1);s+=Math.floor(p/36)+p%36}console.log(f+C[(36-s%36)%36])" "$1"; }
entry() { # entry <purpose> <date> <lines-json> → id of a created+submitted entry (or the failing response)
  local r; r=$(req POST /stock-entries "{\"purpose\":\"$1\",\"postingDate\":\"$2\",\"lines\":$3}")
  [ "${r%% *}" = 201 ] || { echo "$r"; return; }
  local id; id=$(field "$r" "d['id']"); req POST "/stock-entries/$id/submit" ''
}

expect "sign up" 200 "$(req POST /auth/sign-up/email "{\"email\":\"inv$run@example.com\",\"password\":\"Sup3r-secret-pw\",\"name\":\"Stores Owner\"}")"
r=$(req POST /tenants '{"name":"Inventory Smoke","entity":{"legalName":"Azeonics Private Limited","shortName":"Azeonics","code":"AZ","pan":"AAACA1234B"}}')
expect "tenant + entity" 201 "$r"; T=$(field "$r" "d['tenant']['id']"); E=$(field "$r" "d['entity']['id']")
SCOPE=(-H "x-tenant-id: $T")

r=$(req GET /uoms); expect "default UoMs seeded" 200 "$r"
KG=$(field "$r" "[u['id'] for u in d if u['code']=='KG'][0]"); NOS=$(field "$r" "[u['id'] for u in d if u['code']=='NOS'][0]")
r=$(req POST /items "{\"code\":\"TI64-BAR-50\",\"name\":\"Ti-6Al-4V bar 50mm\",\"type\":\"raw_material\",\"tracking\":\"batch\",\"stockUomId\":\"$KG\",\"hsnCode\":\"81089090\",\"requiresIncomingInspection\":true}")
expect "batch-tracked raw material" 201 "$r"; TI=$(field "$r" "d['id']")
r=$(req POST /items "{\"code\":\"M4-SCREW\",\"name\":\"M4 screw SS\",\"type\":\"consumable\",\"stockUomId\":\"$NOS\"}")
expect "untracked consumable" 201 "$r"; SC=$(field "$r" "d['id']")
expect "duplicate item code refused" 409 "$(req POST /items "{\"code\":\"m4-screw\",\"name\":\"Duplicate\",\"type\":\"consumable\",\"stockUomId\":\"$NOS\"}")"
expect "tracking can't change" 400 "$(req PATCH /items/$TI '{"tracking":"none"}')"
expect "invalid supplier GSTIN refused" 400 "$(req POST /parties '{"code":"BADS","name":"Bad","isSupplier":true,"gstin":"27AAACB1234B1Z0"}')"
r=$(req POST /parties "{\"code\":\"TIMET\",\"name\":\"Titanium Metals India\",\"isSupplier\":true,\"gstin\":\"$(gstin 29AAACT1234B1Z)\",\"msmeUdyam\":\"UDYAM-KA-03-0001234\",\"msmeCategory\":\"small\",\"creditDays\":45}")
expect "supplier with GSTIN + MSME" 201 "$r"; SUP=$(field "$r" "d['id']")
check "state derived from GSTIN" "$(field "$r" "d['stateCode']")" "29"

expect "inventory needs an entity" 400 "$(req GET /warehouses)"
SCOPE=(-H "x-tenant-id: $T" -H "x-entity-id: $E")
r=$(req POST /warehouses/standard); expect "standard warehouses" 201 "$r"
wh() { field "$(req GET /warehouses)" "[w['id'] for w in d if w['code']=='$1'][0]"; }
QUAR=$(wh QUAR); STORES=$(wh STORES); CUST=$(wh CUST)

r=$(entry receipt 2026-10-01 "[{\"itemId\":\"$TI\",\"qty\":\"10\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"HN-23-4471\",\"heatNo\":\"HN-23-4471\",\"rate\":\"5000\"},{\"itemId\":\"$TI\",\"qty\":\"5\",\"toWarehouseId\":\"$STORES\",\"newBatchNo\":\"HN-23-4480\",\"heatNo\":\"HN-23-4480\",\"rate\":\"6000\"},{\"itemId\":\"$SC\",\"qty\":\"100\",\"toWarehouseId\":\"$STORES\",\"rate\":\"2\"}]")
expect "receipt submitted" 201 "$r"; R1=$(field "$r" "d['id']")
check "gapless number" "$(field "$r" "d['number']")" "AZ/SE/26-27/00001"
B1=$(field "$(req GET "/batches?itemId=$TI")" "[b['id'] for b in d if b['batchNo']=='HN-23-4471'][0]")
check "in-stock batches per warehouse" "$(field "$(req GET "/batches?itemId=$TI&warehouseId=$QUAR&inStock=true")" "[(b['batchNo'], b['qty']) for b in d]")" "[('HN-23-4471', '10.000000')]"
check "entry list shows lines and value" "$(field "$(req GET "/stock-entries?status=submitted")" "[(e['lineCount'], e['totalValue']) for e in d if e['id']=='$R1']")" "[(3, '80200.000000')]"

expect "batch item needs a batch" 400 "$(entry issue 2026-10-02 "[{\"itemId\":\"$TI\",\"qty\":\"1\",\"fromWarehouseId\":\"$STORES\"}]")"
expect "quarantine stock can't be issued" 400 "$(entry issue 2026-10-02 "[{\"itemId\":\"$TI\",\"qty\":\"1\",\"fromWarehouseId\":\"$QUAR\",\"batchId\":\"$B1\"}]")"
expect "transfer quarantine → stores (QC passed)" 201 "$(entry transfer 2026-10-02 "[{\"itemId\":\"$TI\",\"qty\":\"10\",\"fromWarehouseId\":\"$QUAR\",\"toWarehouseId\":\"$STORES\",\"batchId\":\"$B1\"}]")"
r=$(entry issue 2026-10-03 "[{\"itemId\":\"$TI\",\"qty\":\"4\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$B1\"}]")
expect "issue 4 kg of heat HN-23-4471" 201 "$r"; I1=$(field "$r" "d['id']")
check "issue valued at that heat's cost" "$(field "$(req GET /stock-entries/$I1)" "d['lines'][0]['value']")" "20000.000000"

expect "fastener issue 30" 201 "$(entry issue 2026-10-03 "[{\"itemId\":\"$SC\",\"qty\":\"30\",\"fromWarehouseId\":\"$STORES\"}]")"
expect "fastener receipt 50 @ 3" 201 "$(entry receipt 2026-10-04 "[{\"itemId\":\"$SC\",\"qty\":\"50\",\"toWarehouseId\":\"$STORES\",\"rate\":\"3\"}]")"
r=$(entry issue 2026-10-04 "[{\"itemId\":\"$SC\",\"qty\":\"100\",\"fromWarehouseId\":\"$STORES\"}]")
expect "fastener issue 100 across two layers" 201 "$r"; I2=$(field "$r" "d['id']")
check "FIFO value 70×2 + 30×3" "$(field "$(req GET /stock-entries/$I2)" "d['lines'][0]['value']")" "230.000000"
expect "over-issue refused" 400 "$(entry issue 2026-10-04 "[{\"itemId\":\"$SC\",\"qty\":\"21\",\"fromWarehouseId\":\"$STORES\"}]")"
expect "backdated posting refused" 400 "$(entry receipt 2026-09-30 "[{\"itemId\":\"$SC\",\"qty\":\"1\",\"toWarehouseId\":\"$STORES\",\"rate\":\"2\"}]")"

expect "cancel needs a reason" 400 "$(req POST /stock-entries/$R1/cancel '{"reason":"x"}')"
expect "can't cancel a receipt whose stock was issued" 409 "$(req POST /stock-entries/$R1/cancel '{"reason":"wrong supplier"}')"
expect "cancel the 100-unit issue" 201 "$(req POST /stock-entries/$I2/cancel '{"reason":"issued to wrong work order"}')"
r=$(req GET "/stock/balance?itemId=$SC")
check "fastener qty restored" "$(field "$r" "d[0]['qty']")" "120.000000"
check "FIFO layers restored (70×2 + 50×3)" "$(field "$r" "d[0]['value']")" "290.00"
expect "submitted entries are immutable" 409 "$(req PUT /stock-entries/$I2 "{\"purpose\":\"issue\",\"postingDate\":\"2026-10-04\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"1\",\"fromWarehouseId\":\"$STORES\"}]}")"

r=$(req GET "/stock/balance?itemId=$TI")
check "heat HN-23-4471: 6 kg worth 30000" "$(field "$r" "[(x['qty'],x['value']) for x in d if x['batchNo']=='HN-23-4471']")" "[('6.000000', '30000.00')]"
check "heat HN-23-4480: 5 kg worth 30000" "$(field "$r" "[(x['qty'],x['value']) for x in d if x['batchNo']=='HN-23-4480']")" "[('5.000000', '30000.00')]"

r=$(req POST /parties "{\"code\":\"SKYR\",\"name\":\"Skyroot Aerospace\",\"isCustomer\":true,\"gstin\":\"$(gstin 36AAACS1234B1Z)\"}")
expect "customer" 201 "$r"; CUS=$(field "$r" "d['id']")
expect "customer area needs an owner" 400 "$(entry receipt 2026-10-05 "[{\"itemId\":\"$SC\",\"qty\":\"40\",\"toWarehouseId\":\"$CUST\"}]")"
r=$(req POST /stock-entries "{\"purpose\":\"receipt\",\"postingDate\":\"2026-10-05\",\"ownerPartyId\":\"$CUS\",\"lines\":[{\"itemId\":\"$SC\",\"qty\":\"40\",\"toWarehouseId\":\"$CUST\"}]}")
expect "customer material receipt (draft)" 201 "$r"
expect "customer material receipt submitted" 201 "$(req POST /stock-entries/$(field "$r" "d['id']")/submit)"
r=$(req GET "/stock/balance?itemId=$SC&warehouseId=$CUST")
check "customer stock carries no value" "$(field "$r" "(d[0]['ownership'], d[0]['ownerName'], d[0]['value'])")" "('customer', 'Skyroot Aerospace', '0.00')"
r=$(req GET "/stock/ledger?itemId=$TI"); expect "stock ledger" 200 "$r"
check "running balance = 11 kg" "$(field "$r" "d[-1]['balanceQty']")" "11.000000"
check "running value = 60000" "$(field "$r" "d[-1]['balanceValue']")" "60000.000000"
r=$(req GET "/stock-entries?status=submitted")
check "numbers are sequential" "$(field "$r" "sorted(e['number'] for e in d)[-1]")" "AZ/SE/26-27/00007"
r=$(req GET /audit); check "postings audited" "$(field "$r" "len([e for e in d if e['action']=='stock_entry.submit'])>=7")" "True"
echo "ALL INVENTORY CHECKS PASSED"
