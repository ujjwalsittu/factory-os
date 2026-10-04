#!/usr/bin/env bash
# End-to-end smoke test of Phase 0 against a running API on a fresh-ish database.
# Usage: API=http://localhost:4000 apps/api/scripts/smoke.sh
# Exits non-zero on the first failed expectation.
set -euo pipefail
B="${API:-http://localhost:4000}/api"
ORIGIN="${WEB_ORIGIN:-http://localhost:3000}"
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
run=$RANDOM
owner="owner$run@example.com"; acct="acct$run@example.com"
H=(-H 'Content-Type: application/json' -H "Origin: $ORIGIN")

req() { # req <jar> <method> <path> [body] [extra curl args...] → prints "status body"
  local jar=$1 m=$2 p=$3 body=${4:-}; shift 4 || shift $#
  local args=(-s -o "$dir/out" -w '%{http_code}' -b "$dir/$jar" -c "$dir/$jar" -X "$m" "${H[@]}" "$@")
  [ -n "$body" ] && args+=(-d "$body")
  local code; code=$(curl "${args[@]}" "$B$p"); echo "$code $(cat "$dir/out")"
}
expect() { # expect <label> <wanted-status> <"status body">
  local got=${3%% *}
  if [ "$got" = "$2" ]; then echo "✓ $1"; else echo "✗ $1: wanted $2 got $3" >&2; exit 1; fi
}
field() { python3 -c "import sys,json;d=json.loads(sys.argv[1].split(' ',1)[1]);print(eval(sys.argv[2]))" "$1" "$2"; }
gstin() { node -e "const C='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',f=process.argv[1];let s=0;for(let i=0;i<14;i++){const p=C.indexOf(f[i])*(i%2?2:1);s+=Math.floor(p/36)+p%36}console.log(f+C[(36-s%36)%36])" "$1"; }

expect "health" 200 "$(req a GET /health '')"
expect "sign up owner" 200 "$(req a POST /auth/sign-up/email "{\"email\":\"$owner\",\"password\":\"Sup3r-secret-pw\",\"name\":\"Owner\"}")"
expect "me" 200 "$(req a GET /me '')"
r=$(req a POST /tenants '{"name":"Smoke Group","entity":{"legalName":"Azeonics Private Limited","shortName":"Azeonics","code":"AZ","pan":"AAACA1234B"}}')
expect "onboarding creates tenant + entity" 201 "$r"
T=$(field "$r" "d['tenant']['id']"); E=$(field "$r" "d['entity']['id']")
TH=(-H "x-tenant-id: $T")

expect "reject bad GSTIN check digit" 400 "$(req a POST /entities/$E/gst-registrations '{"gstin":"27AAACA1234B1Z0"}' "${TH[@]}")"
expect "reject GSTIN of another PAN" 400 "$(req a POST /entities/$E/gst-registrations "{\"gstin\":\"$(gstin 27AAACB1234B1Z)\"}" "${TH[@]}")"
expect "add GSTIN with e-invoice date" 201 "$(req a POST /entities/$E/gst-registrations "{\"gstin\":\"$(gstin 27AAACA1234B1Z)\",\"einvoiceApplicableFrom\":\"2027-04-01\",\"irpProvider\":\"nic_direct\"}" "${TH[@]}")"
r=$(req a POST /entities "{\"legalName\":\"EarthNow Private Limited\",\"shortName\":\"EarthNow\",\"code\":\"EN\",\"parentEntityId\":\"$E\"}" "${TH[@]}")
expect "add subsidiary entity" 201 "$r"; S=$(field "$r" "d['id']")
expect "add plant" 201 "$(req a POST /entities/$E/plants '{"name":"Navi Mumbai","code":"NM1"}' "${TH[@]}")"

r=$(req a GET /roles '' "${TH[@]}"); expect "list roles" 200 "$r"
ACC=$(field "$r" "[x['id'] for x in d if x['systemKey']=='accountant'][0]")
r=$(req a POST /invitations "{\"email\":\"$acct\",\"roles\":[{\"roleId\":\"$ACC\",\"entityIds\":[\"$S\"]}]}" "${TH[@]}")
expect "invite accountant scoped to subsidiary" 201 "$r"; TOK=$(field "$r" "d['inviteUrl'].split('/')[-1]")
expect "public invite lookup" 200 "$(req x GET /invitations/lookup/$TOK '')"
expect "sign up invitee" 200 "$(req b POST /auth/sign-up/email "{\"email\":\"$acct\",\"password\":\"Another-pw-123\",\"name\":\"Accountant\"}")"
expect "owner cannot accept someone else's invite" 403 "$(req a POST /invitations/accept "{\"token\":\"$TOK\"}")"
expect "invitee accepts" 201 "$(req b POST /invitations/accept "{\"token\":\"$TOK\"}")"
expect "invite can't be reused" 404 "$(req b POST /invitations/accept "{\"token\":\"$TOK\"}")"

r=$(req b GET /me/context '' "${TH[@]}" -H "x-entity-id: $S"); expect "scoped context in subsidiary" 200 "$r"
[ "$(field "$r" "'accounts.voucher.create' in d['permissions'] and 'compliance.gst_return.file' not in d['permissions']")" = True ] && echo "✓ maker-checker: accountant can create vouchers, cannot file returns"
expect "no access to parent entity" 403 "$(req b GET /me/context '' "${TH[@]}" -H "x-entity-id: $E")"
expect "no tenant-wide member list" 403 "$(req b GET /members '' "${TH[@]}")"
expect "cannot create roles" 403 "$(req b POST /roles '{"name":"x","permissions":[]}' "${TH[@]}")"
expect "foreign tenant rejected" 403 "$(req b GET /me/context '' -H 'x-tenant-id: 00000000-0000-4000-8000-000000000000')"
expect "platform console needs SuperAdmin" 403 "$(req a GET /platform/tenants '')"
expect "anonymous rejected" 401 "$(req z GET /me '')"

r=$(req a GET /audit '' "${TH[@]}"); expect "audit log" 200 "$r"
[ "$(field "$r" "all(d[i]['prevHash']==d[i+1]['hash'] for i in range(len(d)-1)) and len(d)>=6")" = True ] && echo "✓ audit hash chain intact"
echo "ALL SMOKE CHECKS PASSED"
