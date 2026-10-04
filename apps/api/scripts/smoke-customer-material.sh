#!/usr/bin/env bash
# Customer-supplied material + waste register checks (decisions 024, 025) against a running API.
# Usage: API=http://localhost:4000 apps/api/scripts/smoke-customer-material.sh
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
# post <purpose> <date> <owner-or-empty> <party-or-empty> <reference> <lines> → submit response
post() {
  local owner=${3:+\"$3\"} partyv=${4:+\"$4\"}
  local r; r=$(req POST /stock-entries "{\"purpose\":\"$1\",\"postingDate\":\"$2\",\"ownerPartyId\":${owner:-null},\"partyId\":${partyv:-null},\"reference\":\"$5\",\"lines\":$6}")
  [ "${r%% *}" = 201 ] || { echo "$r"; return; }
  req POST "/stock-entries/$(field "$r" "d['id']")/submit"
}

expect "sign up" 200 "$(req POST /auth/sign-up/email "{\"email\":\"cm$run@example.com\",\"password\":\"Sup3r-secret-pw\",\"name\":\"Plant Head\"}")"
r=$(req POST /tenants '{"name":"Customer Material","entity":{"legalName":"Azeonics Private Limited","shortName":"Azeonics","code":"AZ","pan":"AAACA1234B"}}')
T=$(field "$r" "d['tenant']['id']"); E=$(field "$r" "d['entity']['id']")
SCOPE=(-H "x-tenant-id: $T" -H "x-entity-id: $E")
KG=$(field "$(req GET /uoms)" "[u['id'] for u in d if u['code']=='KG'][0]")
AL=$(field "$(req POST /items "{\"code\":\"AL7075-PLATE\",\"name\":\"Al 7075-T6 plate\",\"type\":\"raw_material\",\"tracking\":\"batch\",\"stockUomId\":\"$KG\"}")" "d['id']")
CUS=$(field "$(req POST /parties "{\"code\":\"SKYR\",\"name\":\"Skyroot Aerospace\",\"isCustomer\":true,\"gstin\":\"$(gstin 36AAACS1234B1Z)\"}")" "d['id']")
OTHER=$(field "$(req POST /parties "{\"code\":\"AGNI\",\"name\":\"Agnikul Cosmos\",\"isCustomer\":true,\"gstin\":\"$(gstin 33AAACA9876B1Z)\"}")" "d['id']")
SUP=$(field "$(req POST /parties "{\"code\":\"ALSUP\",\"name\":\"Hindalco\",\"isSupplier\":true,\"gstin\":\"$(gstin 27AAACH1234B1Z)\"}")" "d['id']")
REC=$(field "$(req POST /parties "{\"code\":\"RECYC\",\"name\":\"Green Metal Recyclers\",\"isSupplier\":true,\"gstin\":\"$(gstin 27AAACG1234B1Z)\"}")" "d['id']")
req POST /warehouses/standard >/dev/null
wh() { field "$(req GET /warehouses)" "[w['id'] for w in d if w['code']=='$1'][0]"; }
QUAR=$(wh QUAR); STORES=$(wh STORES); SCRAPW=$(wh SCRAP)

expect "company receipt 20 kg @ 800" 201 "$(post receipt 2026-10-01 "" "$SUP" "HIN/INV/1" "[{\"itemId\":\"$AL\",\"qty\":\"20\",\"toWarehouseId\":\"$STORES\",\"newBatchNo\":\"CO-1\",\"rate\":\"800\"}]")"
expect "customer material can't carry a cost" 400 "$(post receipt 2026-10-02 "$CUS" "$CUS" "SKY/DC/1001" "[{\"itemId\":\"$AL\",\"qty\":\"50\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"SKY-HT-77\",\"rate\":\"700\"}]")"
expect "owner must be a customer" 400 "$(req POST /stock-entries "{\"purpose\":\"receipt\",\"postingDate\":\"2026-10-02\",\"ownerPartyId\":\"$SUP\",\"lines\":[{\"itemId\":\"$AL\",\"qty\":\"1\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"X\"}]}")"
expect "customer sends 50 kg (their challan)" 201 "$(post receipt 2026-10-02 "$CUS" "$CUS" "SKY/DC/1001" "[{\"itemId\":\"$AL\",\"qty\":\"50\",\"toWarehouseId\":\"$QUAR\",\"newBatchNo\":\"SKY-HT-77\"}]")"
CB=$(field "$(req GET "/batches?itemId=$AL&owner=$CUS&inStock=true")" "d[0]['id']")
check "batch picker filters by owner" "$(field "$(req GET "/batches?itemId=$AL&owner=company&inStock=true")" "[b['batchNo'] for b in d]")" "['CO-1']"
expect "QC passed: transfer keeps the owner" 201 "$(post transfer 2026-10-03 "$CUS" "" "QC-1" "[{\"itemId\":\"$AL\",\"qty\":\"50\",\"fromWarehouseId\":\"$QUAR\",\"toWarehouseId\":\"$STORES\",\"batchId\":\"$CB\"}]")"
expect "our 25 kg can't come from the customer's stock" 400 "$(post issue 2026-10-03 "" "" "WO-9" "[{\"itemId\":\"$AL\",\"qty\":\"25\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$CB\"}]")"
r=$(post issue 2026-10-04 "$CUS" "" "WO-1" "[{\"itemId\":\"$AL\",\"qty\":\"30\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$CB\"}]")
expect "consume 30 kg of customer material on WO-1" 201 "$r"
check "consumption has no cost" "$(field "$(req GET /stock-entries/$(field "$r" "d['id']"))" "d['lines'][0]['value']")" "0.000000"
r=$(post scrap 2026-10-05 "$CUS" "" "NCR-12" "[{\"itemId\":\"$AL\",\"qty\":\"2\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$CB\",\"wasteCategory\":\"rejected_parts\"}]")
expect "scrap 2 kg of rejected customer parts" 201 "$r"; SCRAP_ID=$(field "$r" "d['id']")
expect "scrap needs a waste category" 400 "$(req POST /stock-entries "{\"purpose\":\"scrap\",\"postingDate\":\"2026-10-05\",\"ownerPartyId\":\"$CUS\",\"lines\":[{\"itemId\":\"$AL\",\"qty\":\"1\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$CB\"}]}")"
expect "can't return to a different customer" 400 "$(req POST /stock-entries "{\"purpose\":\"return\",\"postingDate\":\"2026-10-06\",\"ownerPartyId\":\"$CUS\",\"partyId\":\"$OTHER\",\"lines\":[{\"itemId\":\"$AL\",\"qty\":\"1\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$CB\"}]}")"
expect "return 10 kg unused to Skyroot" 201 "$(post return 2026-10-06 "$CUS" "$CUS" "AZ/RDC/1" "[{\"itemId\":\"$AL\",\"qty\":\"10\",\"fromWarehouseId\":\"$STORES\",\"batchId\":\"$CB\"}]")"

W=(\"uomId\":\"$KG\",\"ownerPartyId\":\"$CUS\")
expect "swarf generated 6.5 kg (WO-1)" 201 "$(req POST /waste "{\"kind\":\"generated\",\"movementDate\":\"2026-10-04\",\"category\":\"metal_swarf\",\"material\":\"Al 7075 swarf\",\"qty\":\"6.5\",\"uomId\":\"$KG\",\"ownerPartyId\":\"$CUS\",\"warehouseId\":\"$SCRAPW\",\"sourceRef\":\"WO-1\"}")"
expect "disposal of customer waste needs consent" 400 "$(req POST /waste "{\"kind\":\"disposed\",\"movementDate\":\"2026-10-07\",\"category\":\"metal_swarf\",\"material\":\"Al 7075 swarf\",\"qty\":\"4\",\"uomId\":\"$KG\",\"ownerPartyId\":\"$CUS\",\"disposalMethod\":\"authorised_recycler\",\"counterpartyId\":\"$REC\",\"documentNo\":\"GMR/22\"}")"
expect "disposal needs a document number" 400 "$(req POST /waste "{\"kind\":\"disposed\",\"movementDate\":\"2026-10-07\",\"category\":\"metal_swarf\",\"material\":\"Al 7075 swarf\",\"qty\":\"4\",\"uomId\":\"$KG\",\"ownerPartyId\":\"$CUS\",\"disposalMethod\":\"authorised_recycler\",\"counterpartyId\":\"$REC\",\"consentRef\":\"Email 06-Oct\"}")"
r=$(req POST /waste "{\"kind\":\"disposed\",\"movementDate\":\"2026-10-07\",\"category\":\"metal_swarf\",\"material\":\"Al 7075 swarf\",\"qty\":\"4\",\"uomId\":\"$KG\",\"ownerPartyId\":\"$CUS\",\"disposalMethod\":\"authorised_recycler\",\"counterpartyId\":\"$REC\",\"documentNo\":\"GMR/22\",\"consentRef\":\"Skyroot email 06-Oct-2026\"}")
expect "4 kg to recycler with consent" 201 "$r"; DISP=$(field "$r" "d['id']")
expect "can't dispose more than on hand" 400 "$(req POST /waste "{\"kind\":\"disposed\",\"movementDate\":\"2026-10-07\",\"category\":\"metal_swarf\",\"material\":\"Al 7075 swarf\",\"qty\":\"3\",\"uomId\":\"$KG\",\"ownerPartyId\":\"$CUS\",\"disposalMethod\":\"returned_to_customer\"}")"
expect "2.5 kg swarf returned to customer" 201 "$(req POST /waste "{\"kind\":\"disposed\",\"movementDate\":\"2026-10-07\",\"category\":\"metal_swarf\",\"material\":\"Al 7075 swarf\",\"qty\":\"2.5\",\"uomId\":\"$KG\",\"ownerPartyId\":\"$CUS\",\"disposalMethod\":\"returned_to_customer\",\"documentNo\":\"AZ/RDC/2\"}")"
expect "our own coolant can't be 'returned to customer'" 400 "$(req POST /waste "{\"kind\":\"disposed\",\"movementDate\":\"2026-10-07\",\"category\":\"coolant_oil\",\"material\":\"Spent coolant\",\"qty\":\"1\",\"uomId\":\"$KG\",\"disposalMethod\":\"returned_to_customer\"}")"

r=$(req GET /waste/balances); expect "waste balances" 200 "$r"
check "rejected parts pending (from scrap entry)" "$(field "$r" "[(x['balance'], x['ownerName']) for x in d if x['category']=='rejected_parts']")" "[('2.000000', 'Skyroot Aerospace')]"
check "swarf fully accounted" "$(field "$r" "[x['balance'] for x in d if x['category']=='metal_swarf']")" "['0.000000']"

r=$(req GET "/reports/customer-material?partyId=$CUS&from=2026-10-01&to=2026-10-31"); expect "customer statement" 200 "$r"
check "statement: received / consumed / returned / scrapped / closing" "$(field "$r" "[(i['received'], i['consumed'], i['returned'], i['scrapped'], i['closing']) for i in d['items']]")" "[('50.000000', '30.000000', '10.000000', '2.000000', '8.000000')]"
check "statement: swarf generated / returned / disposed / pending" "$(field "$r" "[(w['generated'], w['returned'], w['disposedWithConsent'], w['pending']) for w in d['waste'] if w['category']=='metal_swarf']")" "[('6.500000', '2.500000', '4.000000', '0.000000')]"
check "statement excludes internal transfers" "$(field "$r" "sorted(set(m['purpose'] for m in d['movements']))")" "['issue', 'receipt', 'return', 'scrap']"
check "other customers see nothing" "$(field "$(req GET "/reports/customer-material?partyId=$OTHER&from=2026-10-01&to=2026-10-31")" "(len(d['items']), len(d['waste']))")" "(0, 0)"

expect "generated waste with disposals can't be cancelled first" 409 "$(req POST /waste/$(field "$(req GET '/waste?category=metal_swarf')" "[w['id'] for w in d if w['kind']=='generated'][0]")/cancel '{"reason":"weighed wrong"}')"
expect "cancel the recycler disposal" 201 "$(req POST /waste/$DISP/cancel '{"reason":"consent withdrawn, material held"}')"
expect "cancel the scrap entry" 201 "$(req POST /stock-entries/$SCRAP_ID/cancel '{"reason":"NCR overturned, parts usable"}')"
r=$(req GET "/reports/customer-material?partyId=$CUS&from=2026-10-01&to=2026-10-31")
check "after cancels: scrapped 0, closing 10" "$(field "$r" "[(i['scrapped'], i['closing']) for i in d['items']]")" "[('0.000000', '10.000000')]"
check "after cancels: swarf pending 4" "$(field "$r" "[w['pending'] for w in d['waste'] if w['category']=='metal_swarf']")" "['4.000000']"

r=$(req GET "/stock/balance?itemId=$AL&owner=company")
check "company FIFO untouched: 20 kg worth 16000" "$(field "$r" "[(x['qty'], x['value']) for x in d]")" "[('20.000000', '16000.00')]"
r=$(req GET "/stock/balance?itemId=$AL&owner=customers")
check "customer stock beside it, unvalued" "$(field "$r" "[(x['ownerName'], x['qty'], x['value']) for x in d]")" "[('Skyroot Aerospace', '10.000000', '0.00')]"
echo "ALL CUSTOMER MATERIAL CHECKS PASSED"
