# Four throwaway players fill a table, bid 1NT by the dealer, check the card
# play's refusals, then play all 13 tricks with a legal card each time.
# Usage: bash play-flow.sh "$(cygpath -w <scratchpad>)" [keep [tricks]]
#   keep: leave the table seated afterwards (to look at it in a browser);
#   tricks: stop once that many tricks are complete (default 13), plus one lead.
S="$1"; KEEP="$2"; STOP=${3:-13}; B=http://127.0.0.1:8000; R=$RANDOM
H=(-H "Origin: http://localhost:3000" -H "Referer: http://localhost:3000/" -H "Accept: application/json" --max-time 20)
xs() { curl -s -o /dev/null -c "$S/jar$1" -b "$S/jar$1" "${H[@]}" $B/sanctum/csrf-cookie; awk '$6=="XSRF-TOKEN"{print $7}' "$S/jar$1" | sed 's/%3D/=/g;s/%2F/\//g;s/%2B/+/g'; }
req() { u=$1; m=$2; p=$3; d=$4; X=$(xs $u); curl -s -o "$S/r.json" -w '%{http_code}' -c "$S/jar$u" -b "$S/jar$u" "${H[@]}" -H "X-XSRF-TOKEN: $X" -H 'Content-Type: application/json' -X $m ${d:+-d "$d"} $B$p; }
j() { python -c "import json,sys;d=json.load(open(r'$S/r.json'));print(eval(sys.argv[1]))" "$1"; }
curl -s $B/bids > "$S/bids.json"
bid() { python -c "import json,sys;print(next(b['id'] for b in json.load(open(r'$S/bids.json'))['data'] if b['call']==sys.argv[1]))" "$1"; }
for u in N E S W; do rm -f "$S/jar$u"; echo "register $u: $(req $u POST /register "{\"name\":\"P28 $u\",\"username\":\"p28${u,,}$R\",\"email\":\"p28${u,,}$R@example.com\",\"password\":\"secret123\",\"password_confirmation\":\"secret123\"}")"; done
echo "create: $(req N POST /tables '{"name":"p28 play","seat":"N"}')"; T=$(j "d['data']['id']")
for u in E S W; do echo "$u sits: $(req $u POST /tables/$T/seats "{\"seat\":\"$u\"}")"; done
req N GET /tables/$T/playing >/dev/null; D=$(j "d['data']['board']['dealer']")
order=(N E S W); i=0; while [ "${order[$i]}" != "$D" ]; do i=$((i+1)); done
seat() { echo ${order[$(( (i + $1) % 4 ))]}; }
for k in 0 1 2 3; do req $(seat $k) POST /tables/$T/calls "{\"bid_id\":$(bid $([ $k = 0 ] && echo 1NT || echo P))}" >/dev/null; done
echo "table $T: 1NT by $D, phase $(j "d['data']['phase']"), dummy $(j "d['data']['contract']['dummy']"), turn $(j "d['data']['turn']")"
# The seat that must act, and a card from the hand on play: legal unless $1 is "off" (off-suit on purpose).
actor() { req N GET /tables/$T/playing >/dev/null; j "next(s for s,u in d['data']['players'].items() if u['id']==d['data']['acting_user_id'])"; }
pick() { req $1 GET /tables/$T/playing >/dev/null; python -c "
import json
s = json.load(open(r'$S/r.json'))['data']
hand = s['hand'] if s['turn'] == s['my_seat'] else s['dummy_hand']
led = s['current_trick'][0]['card']['suit'] if s['current_trick'] else None
follow = [c for c in hand if c['suit'] == led]
off = [c for c in hand if c['suit'] != led]
if '$2' == 'off':
    if follow and off: print(off[0]['id'])  # only illegal while the suit led is held
else:
    print((follow or hand)[0]['id'])
"; }
play() { code=$(req $1 POST /tables/$T/cards "{\"card_id\":$2}"); echo "$code $(j "d['message']")"; }
echo "dummy tries to play: $(play $(seat 2) 1)"
echo "wrong turn: $(play $(seat 3) 1)"
req N GET /tables/$T/playing >/dev/null; echo "dummy_hand before lead: $(j "d['data']['dummy_hand']")"
A=$(actor); echo "opening lead by $A: $(play $A $(pick $A))"
req N GET /tables/$T/playing >/dev/null; echo "dummy_hand after lead: $(j "len(d['data']['dummy_hand'])") cards, turn $(j "d['data']['turn']"), acting $(actor)"
A=$(actor); echo "declarer's own card on dummy's turn: $(play $A $(req $A GET /tables/$T/playing >/dev/null; j "d['data']['hand'][0]['id']"))"
followed=0
while :; do
  req N GET /tables/$T/playing >/dev/null; [ "$(j "d['data']['phase']")" = play ] || break
  [ "$(j "len(d['data']['tricks'])")" -ge $STOP ] && [ "$(j "len(d['data']['current_trick'])")" -ge 1 ] && break
  A=$(actor)
  if [ $followed = 0 ]; then off=$(pick $A off); if [ -n "$off" ]; then echo "off-suit: $(play $A $off)"; followed=1; fi; fi
  out=$(play $A $(pick $A)); [ "${out%% *}" = 201 ] || echo "unexpected: $out"
done
req N GET /tables/$T/playing >/dev/null
echo "phase $(j "d['data']['phase']") tricks $(j "len(d['data']['tricks'])") won $(j "d['data']['tricks_won']") result $(j "d['data']['result']")"
echo "winners $(j "' '.join(t['winner'] for t in d['data']['tricks'])")"
[ "$KEEP" = keep ] && { echo "kept table $T; log in as p28{n,e,s,w}$R@example.com / secret123 (declarer $D, to act: $(actor))"; exit; }
for u in N E S W; do echo "$u leaves: $(req $u DELETE /tables/$T/seats)"; done
