# Four throwaway players fill a table and run one auction with GET /bids ids.
# Usage: bash auction-flow.sh "$(cygpath -w <scratchpad>)"   (Windows path: see references)
S="$1"; B=http://127.0.0.1:8000; R=$RANDOM
H=(-H "Origin: http://localhost:3000" -H "Referer: http://localhost:3000/" -H "Accept: application/json" --max-time 20)
xs() { curl -s -o /dev/null -c "$S/jar$1" -b "$S/jar$1" "${H[@]}" $B/sanctum/csrf-cookie; awk '$6=="XSRF-TOKEN"{print $7}' "$S/jar$1" | sed 's/%3D/=/g;s/%2F/\//g;s/%2B/+/g'; }
req() { u=$1; m=$2; p=$3; d=$4; X=$(xs $u); curl -s -o "$S/r.json" -w '%{http_code}' -c "$S/jar$u" -b "$S/jar$u" "${H[@]}" -H "X-XSRF-TOKEN: $X" -H 'Content-Type: application/json' -X $m ${d:+-d "$d"} $B$p; }
j() { python -c "import json,sys;d=json.load(open(r'$S/r.json'));print(eval(sys.argv[1]))" "$1"; }
curl -s $B/bids > "$S/bids.json"
bid() { python -c "import json,sys;print(next(b['id'] for b in json.load(open(r'$S/bids.json'))['data'] if b['call']==sys.argv[1]))" "$1"; }
declare -A U
for u in N E S W; do rm -f "$S/jar$u"; echo "register $u: $(req $u POST /register "{\"name\":\"A27 $u\",\"username\":\"a27${u,,}$R\",\"email\":\"a27${u,,}$R@example.com\",\"password\":\"secret123\",\"password_confirmation\":\"secret123\"}")"; done
echo "create: $(req N POST /tables '{"name":"a27 auction","seat":"N"}')"; T=$(j "d['data']['id']")
for u in E S W; do echo "$u sits: $(req $u POST /tables/$T/seats "{\"seat\":\"$u\"}")"; done
req N GET /tables/$T/playing >/dev/null; D=$(j "d['data']['board']['dealer']"); echo "table $T dealer $D turn $(j "d['data']['turn']")"
order=(N E S W); i=0; while [ "${order[$i]}" != "$D" ]; do i=$((i+1)); done
seat() { echo ${order[$(( (i + $1) % 4 ))]}; }
call() { code=$(req $1 POST /tables/$T/calls "{\"bid_id\":$(bid $2)}"); echo "$1 $2 -> $code $(j "d['message']")"; }
call $(seat 1) P                 # not their turn
call $(seat 0) 1H
call $(seat 1) 1D                # too low
call $(seat 2) X                  # wrong turn
call $(seat 1) X
call $(seat 2) X                 # already doubled
call $(seat 2) XX
call $(seat 3) 2C
call $(seat 0) P; call $(seat 1) 4S; call $(seat 2) X; call $(seat 3) P; call $(seat 0) P; call $(seat 1) P
req N GET /tables/$T/playing >/dev/null
echo "phase $(j "d['data']['phase']") contract $(j "d['data']['contract']") turn $(j "d['data']['turn']")"
echo "auction $(j "' '.join(c['seat']+':'+c['bid']['call'] for c in d['data']['auction'])")"
for u in N E S W; do echo "$u leaves: $(req $u DELETE /tables/$T/seats)"; done
