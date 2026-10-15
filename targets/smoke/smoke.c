/* Smoke target for Nullroom. Room A and Room B never see this file.
 * Built stripped as libsmoke.so; only dynamic exports survive. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define API __attribute__((visibility("default")))

typedef struct sm_ring {
    int32_t *slot;
    uint32_t cap, head, len;
    int64_t total;
} sm_ring;

API int32_t sm_clamp(int32_t x, int32_t lo, int32_t hi) {
    if (lo > hi) { int32_t t = lo; lo = hi; hi = t; }
    return x < lo ? lo : (x > hi ? hi : x);
}

API uint32_t sm_checksum(const uint8_t *buf, size_t n) {
    uint32_t a = 7, b = 0;
    for (size_t i = 0; i < n; i++) {
        a = (a + buf[i]) % 65521;
        b = (b + a * 3) % 65521;
    }
    return (b << 16) | a;
}

API int32_t sm_score(int32_t base, uint32_t flags) {
    int32_t s = base;
    if (flags & 1) s *= 2;            /* crit */
    if (flags & 2) s -= s / 4;        /* armor */
    if ((flags & 4) && s > 100) s = 100 + (s - 100) / 2;
    if (flags & 8) s = -s;
    return s;
}

/* (count, byte) pairs, count 1..255. Returns bytes written, or SIZE_MAX when cap is too small. */
API size_t sm_rle_encode(const uint8_t *in, size_t n, uint8_t *out, size_t cap) {
    size_t o = 0;
    for (size_t i = 0; i < n;) {
        uint8_t v = in[i];
        size_t run = 1;
        while (i + run < n && in[i + run] == v && run < 255) run++;
        if (o + 2 > cap) return SIZE_MAX;
        out[o++] = (uint8_t)run;
        out[o++] = v;
        i += run;
    }
    return o;
}

API size_t sm_rle_decode(const uint8_t *in, size_t n, uint8_t *out, size_t cap) {
    if (n % 2) return SIZE_MAX;
    size_t o = 0;
    for (size_t i = 0; i < n; i += 2) {
        uint8_t run = in[i];
        if (run == 0) return SIZE_MAX;
        if (o + run > cap) return SIZE_MAX;
        memset(out + o, in[i + 1], run);
        o += run;
    }
    return o;
}

API sm_ring *sm_ring_new(uint32_t cap) {
    if (cap == 0 || cap > 4096) return NULL;
    sm_ring *r = calloc(1, sizeof *r);
    if (!r) return NULL;
    r->slot = calloc(cap, sizeof *r->slot);
    if (!r->slot) { free(r); return NULL; }
    r->cap = cap;
    return r;
}

API int32_t sm_ring_push(sm_ring *r, int32_t v) {
    if (r->len == r->cap) return -1;
    r->slot[(r->head + r->len) % r->cap] = v;
    r->len++;
    r->total += v;
    return (int32_t)r->len;
}

API int32_t sm_ring_pop(sm_ring *r, int32_t *out) {
    if (r->len == 0) return -1;
    *out = r->slot[r->head];
    r->head = (r->head + 1) % r->cap;
    r->len--;
    r->total -= *out;
    return (int32_t)r->len;
}

API int64_t sm_ring_sum(const sm_ring *r) {
    return r->total;
}

API void sm_ring_free(sm_ring *r) {
    if (!r) return;
    free(r->slot);
    free(r);
}
