# libsmoke behavior spec

Scripted Room A output for the deterministic pipeline run. A real run replaces
this with what the Room A agent writes after studying the binary.

## Exports

```nullroom-abi
handle sm_ring
fn sm_clamp(i32 x, i32 lo, i32 hi) -> i32
fn sm_checksum(in data, len n) -> u32
fn sm_score(i32 base, u32 flags) -> i32
fn sm_rle_encode(in src, len n, out dst, cap c) -> size
fn sm_rle_decode(in src, len n, out dst, cap c) -> size
fn sm_ring_new(u32 cap) -> new sm_ring
fn sm_ring_push(sm_ring r, i32 v) -> i32
fn sm_ring_pop(sm_ring r, out_i32 v) -> i32
fn sm_ring_sum(sm_ring r) -> i64
fn sm_ring_free(sm_ring r) -> free sm_ring
```

## sm_clamp

Limits x to the closed range between lo and hi. When lo is greater than hi the
two bounds are swapped first.

## sm_checksum

Two running sums over the bytes, both kept modulo 65521. The first starts at 7
and adds each byte. The second starts at 0 and, after each byte, adds three
times the updated first sum. Result: second sum in the upper 16 bits, first sum
in the lower 16 bits. Empty input gives 7.

## sm_score

Starts from base, then applies the flag bits in this order:
1. bit value 1: double it.
2. bit value 2: subtract a quarter of the current value (integer division
   truncating toward zero).
3. bit value 4: if the value is above 100, keep 100 plus half of the excess
   (truncating division).
4. bit value 8: negate.
Other bits are ignored. All arithmetic is 32-bit signed with wraparound.

## sm_rle_encode

Run-length encoding into pairs of (count, value). A run is at most 255 equal
bytes; longer runs are split. Writes pairs left to right. If the next pair does
not fit into the remaining capacity, stops and returns the maximum size value;
pairs already written stay in the output. Otherwise returns bytes written.
Empty input returns 0.

## sm_rle_decode

Inverse of encode. Odd input length returns the maximum size value without
writing. Pairs are processed in order; a count of zero, or a run that would
exceed the capacity, stops processing and returns the maximum size value, with
earlier runs left in the output. Otherwise returns bytes written.

## sm_ring

A fixed-capacity FIFO of signed 32-bit values with a running 64-bit total.
- new: capacity must be 1 to 4096, otherwise returns no handle. Starts empty.
- push: when full returns -1 and changes nothing. Otherwise appends, adds the
  value to the total, returns the new count.
- pop: when empty returns -1 and leaves the output untouched. Otherwise removes
  the oldest value, writes it to the output, subtracts it from the total,
  returns the new count.
- sum: the running total.
- free: releases the ring; accepts no handle and then does nothing.
