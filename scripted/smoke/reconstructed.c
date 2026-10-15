/* Scripted Room B output for the deterministic pipeline run, written from
 * scripted/smoke/SPEC.md only. A real run replaces it with the Room B agent's file. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT __attribute__((visibility("default")))
#define FAIL ((size_t)-1)

struct sm_ring {
    uint32_t capacity, first, count;
    int64_t total;
    int32_t values[];
};

EXPORT int32_t sm_clamp(int32_t x, int32_t lo, int32_t hi) {
    int32_t low = lo < hi ? lo : hi;
    int32_t high = lo < hi ? hi : lo;
    if (x < low) return low;
    if (x > high) return high;
    return x;
}

EXPORT uint32_t sm_checksum(const uint8_t *data, size_t n) {
    uint32_t first = 7, second = 0;
    for (size_t i = 0; i < n; i++) {
        first = (first + data[i]) % 65521u;
        second = (second + 3u * first) % 65521u;
    }
    return second << 16 | first;
}

EXPORT int32_t sm_score(int32_t base, uint32_t flags) {
    int32_t v = base;
    if (flags & 1u) v = (int32_t)((uint32_t)v * 2u);
    if (flags & 2u) v = (int32_t)((uint32_t)v - (uint32_t)(v / 4));
    if ((flags & 4u) && v > 100) v = 100 + (v - 100) / 2;
    if (flags & 8u) v = (int32_t)(0u - (uint32_t)v);
    return v;
}

EXPORT size_t sm_rle_encode(const uint8_t *src, size_t n, uint8_t *dst, size_t c) {
    size_t written = 0, pos = 0;
    while (pos < n) {
        size_t run = 1;
        while (pos + run < n && run < 255 && src[pos + run] == src[pos]) run++;
        if (c - written < 2 || written > c) return FAIL;
        dst[written] = (uint8_t)run;
        dst[written + 1] = src[pos];
        written += 2;
        pos += run;
    }
    return written;
}

EXPORT size_t sm_rle_decode(const uint8_t *src, size_t n, uint8_t *dst, size_t c) {
    if (n & 1) return FAIL;
    size_t written = 0;
    for (size_t pos = 0; pos < n; pos += 2) {
        size_t run = src[pos];
        if (run == 0 || run > c - written) return FAIL;
        memset(dst + written, src[pos + 1], run);
        written += run;
    }
    return written;
}

EXPORT struct sm_ring *sm_ring_new(uint32_t cap) {
    if (cap < 1 || cap > 4096) return NULL;
    struct sm_ring *r = calloc(1, sizeof *r + (size_t)cap * sizeof(int32_t));
    if (r) r->capacity = cap;
    return r;
}

EXPORT int32_t sm_ring_push(struct sm_ring *r, int32_t v) {
    if (r->count == r->capacity) return -1;
    r->values[(r->first + r->count) % r->capacity] = v;
    r->count++;
    r->total += v;
    return (int32_t)r->count;
}

EXPORT int32_t sm_ring_pop(struct sm_ring *r, int32_t *v) {
    if (r->count == 0) return -1;
    *v = r->values[r->first];
    r->first = (r->first + 1) % r->capacity;
    r->count--;
    r->total -= *v;
    return (int32_t)r->count;
}

EXPORT int64_t sm_ring_sum(struct sm_ring *r) {
    return r->total;
}

EXPORT void sm_ring_free(struct sm_ring *r) {
    free(r);
}
