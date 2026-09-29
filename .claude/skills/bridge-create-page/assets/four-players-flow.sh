S="$1"; B=http://127.0.0.1:8000; R=$RANDOM
H=(-H "Origin: http://localhost:3000" -H "Referer: http://localhost:3000/" -H "Accept: application/json" --max-time 20)
xs() { curl -s -o /dev/null -c "$S/jar$1" -b "$S/jar$1" "${H[@]}" $B/sanctum/csrf-cookie; awk '$6=="XSRF-TOKEN"{print $7}' "$S/jar$1" | sed 's/%3D/=/g;s/%2F/\//g;s/%2B/+/g'; }
req() { u=$1; m=$2; p=$3; d=$4; X=$(xs $u); curl -s -o "$S/r.json" -w '%{http_code}' -c "$S/jar$u" -b "$S/jar$u" "${H[@]}" -H "X-XSRF-TOKEN: $X" -H 'Content-Type: application/json' -X $m ${d:+-d "$d"} $B$p; }
echo "ping: $(curl -s --max-time 8 $B/)"
for u in a b c d; do rm -f "$S/jar$u"; echo "register $u: $(req $u POST /register "{\"name\":\"G26 $u\",\"username\":\"g26${u}$R\",\"email\":\"g26${u}$R@example.com\",\"password\":\"secret123\",\"password_confirmation\":\"secret123\"}")"; done
echo "create: $(req a POST /tables '{"name":"g26 test","seat":"N"}')"
T=$(python -c "import json;print(json.load(open(r'$S/r.json'))['data']['id'])"); echo "table $T"
echo "E: $(req b POST /tables/$T/seats '{"seat":"E"}')"
echo "S: $(req c POST /tables/$T/seats '{"seat":"S"}')"
echo "W: $(req d POST /tables/$T/seats '{"seat":"W"}') board_id=$(python -c "import json;print(json.load(open(r'$S/r.json'))['data']['board_id'])")"
for u in a b c d; do code=$(req $u GET /tables/$T/playing); python - "$S/r.json" $code $u <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))['data']; h=d['hand']
order='SHDC'; key=[(order.index(c['suit']),-c['rank']) for c in h]
print(sys.argv[3], sys.argv[2], d['phase'], 'seat', d['my_seat'], 'board', d['board'], 'turn', d['turn'], 'cards', len(h), 'sorted', key==sorted(key), 'ranks', sorted({c['rank'] for c in h}), 'other cards', d['dummy_hand'], d['deal'], 'players', {k:v['username'] for k,v in d['players'].items()})
print('  ', ' '.join(c['suit']+str(c['rank']) for c in h))
PY
done
echo "outsider: register e $(rm -f $S/jare; req e POST /register "{\"name\":\"G26 e\",\"username\":\"g26e$R\",\"email\":\"g26e$R@example.com\",\"password\":\"secret123\",\"password_confirmation\":\"secret123\"}") playing=$(req e GET /tables/$T/playing)"
echo "d leaves: $(req d DELETE /tables/$T/seats) board_id=$(python -c "import json;print(json.load(open(r'$S/r.json'))['data']['board_id'])")"
echo "a playing: $(req a GET /tables/$T/playing) $(head -c 300 $S/r.json)"
for u in a b c; do echo "$u leaves: $(req $u DELETE /tables/$T/seats)"; done
echo "table after: $(req a GET /tables/$T)"
