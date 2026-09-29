# Four throwaway players play a board out (1NT by the dealer), check the
# finished state (result, deal, ready), move on with POST /playing/next one
# player at a time, pass the next board out, deal the one after for everyone
# (the creator manages), and check the history and leaving between boards.
# Usage: bash next-board-flow.sh "$(cygpath -w <scratchpad>)" [keep]
#   keep: stop on a finished board with nobody ready, seated, for a browser.
S="$1"; KEEP="$2"; B=http://127.0.0.1:8000; R=$RANDOM
H=(-H "Origin: http://localhost:3000" -H "Referer: http://localhost:3000/" -H "Accept: application/json" --max-time 20)
xs() { curl -s -o /dev/null -c "$S/jar$1" -b "$S/jar$1" "${H[@]}" $B/sanctum/csrf-cookie; awk '$6=="XSRF-TOKEN"{print $7}' "$S/jar$1" | sed 's/%3D/=/g;s/%2F/\//g;s/%2B/+/g'; }
req() { u=$1; m=$2; p=$3; d=$4; X=$(xs $u); curl -s -o "$S/r.json" -w '%{http_code}' -c "$S/jar$u" -b "$S/jar$u" "${H[@]}" -H "X-XSRF-TOKEN: $X" -H 'Content-Type: application/json' -X $m ${d:+-d "$d"} $B$p; }
j() { python -c "import json,sys;d=json.load(open(r'$S/r.json'));print(eval(sys.argv[1]))" "$1"; }
curl -s $B/bids > "$S/bids.json"
bid() { python -c "import json,sys;print(next(b['id'] for b in json.load(open(r'$S/bids.json'))['data'] if b['call']==sys.argv[1]))" "$1"; }
for u in N E S W; do rm -f "$S/jar$u"; echo "register $u: $(req $u POST /register "{\"name\":\"P29 $u\",\"username\":\"p29${u,,}$R\",\"email\":\"p29${u,,}$R@example.com\",\"password\":\"secret123\",\"password_confirmation\":\"secret123\"}")"; done
echo "create: $(req N POST /tables '{"name":"p29 next board","seat":"N"}')"; T=$(j "d['data']['id']")
for u in E S W; do echo "$u sits: $(req $u POST /tables/$T/seats "{\"seat\":\"$u\"}")"; done
order=(N E S W)
# Every call of an auction, dealer first: $1 for the dealer, passes after.
auction() { req N GET /tables/$T/playing >/dev/null; D=$(j "d['data']['board']['dealer']"); i=0; while [ "${order[$i]}" != "$D" ]; do i=$((i+1)); done
  for k in 0 1 2 3; do req ${order[$(( (i + k) % 4 ))]} POST /tables/$T/calls "{\"bid_id\":$(bid $([ $k = 0 ] && echo $1 || echo P))}" >/dev/null; done; }
actor() { req N GET /tables/$T/playing >/dev/null; j "next(s for s,u in d['data']['players'].items() if u['id']==d['data']['acting_user_id'])"; }
pick() { req $1 GET /tables/$T/playing >/dev/null; python -c "
import json
s = json.load(open(r'$S/r.json'))['data']
hand = s['hand'] if s['turn'] == s['my_seat'] else s['dummy_hand']
led = s['current_trick'][0]['card']['suit'] if s['current_trick'] else None
print(([c for c in hand if c['suit'] == led] or hand)[0]['id'])
"; }
playout() { while :; do req N GET /tables/$T/playing >/dev/null; [ "$(j "d['data']['phase']")" = play ] || break
  A=$(actor); code=$(req $A POST /tables/$T/cards "{\"card_id\":$(pick $A)}"); [ $code = 201 ] || echo "unexpected $code $(j "d['message']")"; done; }
state() { req ${1:-N} GET /tables/$T/playing >/dev/null; echo "board $(j "d['data']['board']['number']") phase $(j "d['data']['phase']") ready $(j "d['data']['ready']") result $(j "d['data']['result'] and {k: v for k, v in d['data']['result'].items() if k != 'contract'}")"; }
next() { code=$(req $1 POST /tables/$T/playing/next "$2"); echo "$1 next$2: $code $(j "d['message']") phase $(j "(d.get('data') or {}).get('phase')") ready $(j "(d.get('data') or {}).get('ready')")"; }

auction 1NT; playout
state; echo "deal sizes $(j "{s: len(h) for s, h in d['data']['deal'].items()}") hand $(j "len(d['data']['hand'])") contract $(j "d['data']['result']['contract']['call']")"
[ "$KEEP" = keep ] && { echo "kept table $T; log in as p29{n,e,s,w}$R@example.com / secret123"; exit; }
echo "card after the end: $(req N POST /tables/$T/cards '{"card_id":1}') $(j "d['message']")"
next N; next N; next E '{"everyone":true}'; next E; next S
B1=$(j "d['data']['board']['id']"); next W
echo "new board $(j "d['data']['board']['number']") (id $(j "d['data']['board']['id']"), was $B1) hand $(j "len(d['data']['hand'])") result $(j "d['data']['result']") deal $(j "d['data']['deal']")"
echo "too early: $(req N POST /tables/$T/playing/next) $(j "d['message']")"
auction P; state
next N '{"everyone":true}'; state
auction 1NT; playout; state
req S GET /api/user/playings >/dev/null
echo "S history at table $T: $(j "[(e['board']['number'], e['score_ns'], e['score']) for e in d['data']['data'] if e['table_id'] == $T]")"
echo "W leaves between boards: $(req W DELETE /tables/$T/seats) board_id $(j "d['data']['board_id']")"
state N; next N
for u in N E S; do echo "$u leaves: $(req $u DELETE /tables/$T/seats)"; done
