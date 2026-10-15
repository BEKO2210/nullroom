/* Fixed example calls for the 10 smoke exports. Prints one JSON object.
 * Linked once against the original library and once against the rebuild;
 * the oracle compares the two outputs. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct sm_ring sm_ring;
int32_t sm_clamp(int32_t x, int32_t lo, int32_t hi);
uint32_t sm_checksum(const uint8_t *data, size_t n);
int32_t sm_score(int32_t base, uint32_t flags);
size_t sm_rle_encode(const uint8_t *src, size_t n, uint8_t *dst, size_t c);
size_t sm_rle_decode(const uint8_t *src, size_t n, uint8_t *dst, size_t c);
sm_ring *sm_ring_new(uint32_t cap);
int32_t sm_ring_push(sm_ring *r, int32_t v);
int32_t sm_ring_pop(sm_ring *r, int32_t *v);
int64_t sm_ring_sum(sm_ring *r);
void sm_ring_free(sm_ring *r);

static void bytes(const char *key, const uint8_t *b, size_t n) {
    printf("\"%s\":[", key);
    for (size_t i = 0; i < n; i++) printf(i ? ",%u" : "%u", b[i]);
    printf("],");
}

int main(void) {
    printf("{");

    printf("\"clamp\":[%d,%d,%d,%d,%d],",
           sm_clamp(5, 0, 10), sm_clamp(-3, 0, 10), sm_clamp(42, 0, 10),
           sm_clamp(7, 10, 0), sm_clamp(10, 0, 10));

    const uint8_t text[] = "nullroom";
    printf("\"checksum\":[%u,%u],", sm_checksum(text, 0), sm_checksum(text, 8));

    printf("\"score\":[%d,%d,%d,%d,%d,%d],",
           sm_score(10, 0), sm_score(10, 1), sm_score(100, 2),
           sm_score(150, 4), sm_score(150, 1 | 4), sm_score(30, 1 | 2 | 8));

    const uint8_t plain[] = {7, 7, 7, 1, 2, 2};
    uint8_t enc[16] = {0}, dec[16] = {0};
    size_t en = sm_rle_encode(plain, sizeof plain, enc, sizeof enc);
    size_t dn = sm_rle_decode(enc, en, dec, sizeof dec);
    printf("\"rle_len\":[%zu,%zu],", en, dn);
    bytes("rle_enc", enc, en);
    bytes("rle_dec", dec, dn);
    uint8_t exact[6] = {0};
    printf("\"rle_exact_cap\":[%zu,%d],", sm_rle_decode(enc, en, exact, 6),
           sm_rle_decode(enc, en, exact, 5) == SIZE_MAX);
    uint8_t tiny[3] = {0};
    printf("\"rle_small_cap\":%d,", sm_rle_encode(plain, sizeof plain, tiny, sizeof tiny) == SIZE_MAX);
    const uint8_t odd[] = {2, 9, 1};
    printf("\"rle_odd\":%d,", sm_rle_decode(odd, sizeof odd, dec, sizeof dec) == SIZE_MAX);

    /* Fixed edge values. */
    static const int32_t E[] = {0, 1, -1, 99, 100, 101, 255, -255, INT32_MAX, INT32_MIN};
    const int ne = sizeof E / sizeof E[0];

    printf("\"clamp_edges\":[");
    for (int i = 0; i < ne; i++)
        printf(i ? ",%d,%d" : "%d,%d", sm_clamp(E[i], -1, 255), sm_clamp(E[i], 255, -1));
    printf("],");

    printf("\"score_edges\":[");
    static const uint32_t F[] = {0, 1, 2, 4, 8, 3, 5, 7, 15, 16};
    for (int i = 0; i < ne; i++)
        for (int j = 0; j < 10; j++) printf(i || j ? ",%d" : "%d", sm_score(E[i], F[j]));
    printf("],");

    uint8_t ones[300];
    memset(ones, 255, sizeof ones);
    printf("\"checksum_edges\":[%u,%u,%u,%u]," , sm_checksum(ones, 1), sm_checksum(ones, 255),
           sm_checksum(ones, 256), sm_checksum(ones, 300));

    /* Runs of 1, 255, 256 equal bytes; encode with capacity exact-1, exact, exact+1. */
    static const size_t RUNS[] = {1, 255, 256};
    printf("\"rle_edges\":[");
    for (int i = 0; i < 3; i++) {
        size_t need = sm_rle_encode(ones, RUNS[i], enc, sizeof enc);
        uint8_t out[300];
        for (int d = -1; d <= 1; d++) {
            memset(enc, 0, sizeof enc);
            size_t e = sm_rle_encode(ones, RUNS[i], enc, need + d);
            memset(out, 0, sizeof out);
            size_t back = sm_rle_decode(enc, need, out, RUNS[i] + d);
            printf(i || d != -1 ? ",%d,%d" : "%d,%d", e == SIZE_MAX ? -1 : (int)e,
                   back == SIZE_MAX ? -1 : (int)back);
        }
    }
    printf("],");

    const uint8_t zero_count[] = {0, 5, 1, 6};
    printf("\"rle_zero_count\":%d,", sm_rle_decode(zero_count, sizeof zero_count, dec, sizeof dec) == SIZE_MAX);

    /* Ring at capacity 1 and 4096, with extreme values in the running total. */
    printf("\"ring_edges\":[");
    static const uint32_t CAPS[] = {1, 4096};
    for (int c = 0; c < 2; c++) {
        sm_ring *e = sm_ring_new(CAPS[c]);
        int32_t last = 0;
        for (uint32_t k = 0; k < CAPS[c]; k++) last = sm_ring_push(e, k % 2 ? INT32_MAX : INT32_MIN);
        int32_t full = sm_ring_push(e, 7);
        int64_t sum = sm_ring_sum(e);
        int32_t got1 = 0, left = sm_ring_pop(e, &got1);
        printf(c ? ",%d,%d,%lld,%d,%d,%lld" : "%d,%d,%lld,%d,%d,%lld", last, full, (long long)sum, left, got1,
               (long long)sm_ring_sum(e));
        sm_ring_free(e);
    }
    printf("],");
    sm_ring_free(NULL);

    printf("\"ring_bad\":[%d,%d,%d],", sm_ring_new(0) == NULL, sm_ring_new(5000) == NULL, sm_ring_new(4097) == NULL);
    sm_ring *r = sm_ring_new(2);
    int32_t v = -99;
    int32_t p1 = sm_ring_push(r, 4), p2 = sm_ring_push(r, 6), p3 = sm_ring_push(r, 8);
    int64_t s1 = sm_ring_sum(r);
    int32_t q1 = sm_ring_pop(r, &v);
    int32_t got = v;
    int32_t q2 = sm_ring_pop(r, &v), q3 = sm_ring_pop(r, &v);
    printf("\"ring\":[%d,%d,%d,%lld,%d,%d,%d,%d,%d,%lld]",
           p1, p2, p3, (long long)s1, q1, got, q2, q3, v, (long long)sm_ring_sum(r));
    sm_ring_free(r);

    printf("}\n");
    return 0;
}
