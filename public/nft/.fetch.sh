#!/usr/bin/env bash
# One-off helper: pull tokens 1..24 metadata from Bitkub Chain → download images.
# We keep 8 existing showcase jpegs and add up to 16 more real token images for a
# larger random pool in the hero orbit.
set -e
CONTRACT="0x0e987608fecaa052b43628c0e5ab5a6e28d933f2"
RPC="https://rpc.bitkubchain.io"
SELECTOR="0xc87b56dd"   # tokenURI(uint256)

fetch_one(){
  local id=$1
  local hex=$(printf '%064x' "$id")
  local raw=$(curl -sS --retry 3 --retry-delay 1 -X POST "$RPC" -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$CONTRACT\",\"data\":\"${SELECTOR}${hex}\"},\"latest\"],\"id\":1}")
  local res=$(echo "$raw" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('result',''))")
  if [ -z "$res" ] || [ "$res" = "0x" ]; then echo "  #$id: RPC miss → skip"; return 1; fi
  local strlen=$((16#${res:66:64}))
  local uri=$(python3 -c "print(bytes.fromhex('${res:130:$((strlen*2))}').decode())")
  local img=$(curl -sS --retry 3 --retry-delay 1 -L "$uri" | python3 -c "import sys,json;print(json.load(sys.stdin).get('image',''))")
  if [ -z "$img" ]; then echo "  #$id: no image in metadata → skip"; return 1; fi
  curl -sS --retry 3 --retry-delay 1 -L "$img" -o "token-$id.jpeg"
  printf "  #%-2s → token-%s.jpeg (%s bytes)\n" "$id" "$id" "$(stat -f %z token-$id.jpeg)"
}

INDEX_SELECTOR="0x4f6ccce7"   # tokenByIndex(uint256)
token_id_for_index(){
  local idx=$1
  local hex=$(printf '%064x' "$idx")
  local raw=$(curl -sS --retry 3 --retry-delay 1 -X POST "$RPC" -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$CONTRACT\",\"data\":\"${INDEX_SELECTOR}${hex}\"},\"latest\"],\"id\":1}")
  local res=$(echo "$raw" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('result',''))")
  [ -z "$res" ] || [ "$res" = "0x" ] && return 1
  python3 -c "print(int('$res', 16))"
}

# Use ERC721Enumerable tokenByIndex to get 24 real minted IDs, then pull metadata.
COUNT=0
for idx in $(seq 0 40); do
  [ "$COUNT" -ge 24 ] && break
  id=$(token_id_for_index "$idx") || continue
  [ -z "$id" ] && continue
  if fetch_one "$id"; then
    COUNT=$((COUNT + 1))
  fi
  sleep 0.2
done
echo "Fetched $COUNT real token images."
