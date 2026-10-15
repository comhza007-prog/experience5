#ifndef E5_ERROR_WAVE_H
#define E5_ERROR_WAVE_H
/* Read-only UART-view conversion, called at the existing 40 ms TX cadence.
 * Replaces only duplicated raw generalized coordinates at I53/I54.
 * Original I3 reference and I5/I6 encoder-derived positions stay in metres.
 * I53: measured mean position minus reference, mm (signed tracking error).
 * I54: left minus right position, mm (signed synchronization error).
 * Neither an RMS statistic nor an independent carriage measurement.
 * No control state, actuator request, guard, event/fault payload or frame
 * length is changed. All107 channels and JustFloat framing are retained. */
static void e5_error_wave(float values[107]) {
    values[53] = 1000.0f * (0.5f * (values[5] + values[6]) - values[3]);
    values[54] = 1000.0f * (values[5] - values[6]);
}
#endif
