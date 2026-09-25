#ifndef CIDBIOCONF_H_
#define CIDBIOCONF_H_

#if defined(_WIN32) || defined(__CYGWIN__)
#define WIN32_AVAILABLE 1
#elif defined(__unix__) || defined(__MACH__) || defined(__NetBSD__) || defined(__sun)
#define UNIX_AVAILABLE  1
#endif

#if defined(WIN32_AVAILABLE) && defined(CALL_CONV_STDCALL)
    #define STDCALL __stdcall
#else 
    #define STDCALL
#endif

#ifdef CIDBIOLIB_EXPORTS

#if defined(WIN32_AVAILABLE) && !defined(DOXYGEN_PROCESSING)
    #define CIDBIOLIB_API __declspec(dllexport)
#elif defined (UNIX_AVAILABLE)
    #define CIDBIOLIB_API __attribute__ ((visibility ("default")))
#else
    #define CIDBIOLIB_API
#endif

#else
#define CIDBIOLIB_API
#endif

#include <stdint.h>

/**
 * @typedef uint8_t as byte;
 * @brief A type definition for a byte
 *
 * byte represents a 8 bit integer.
 *
 */
typedef uint8_t byte;

/**
 * @enum Parameters ids
 * @brief Values used to identify parameters
 * @see CIDBIO_GetParameter and CIDBIO_SetParameter
 *
 */

#define CIDBIO_PARAM_MIN_VAR                        1
#define CIDBIO_PARAM_SIMILARITY_THRESHOLD           2
#define CIDBIO_PARAM_BUZZER_ON                      4
#define CIDBIO_PARAM_TEMPLATE_FORMAT                5
#define CIDBIO_PARAM_ROTATION                       6
#define CIDBIO_PARAM_DETECT_TIMEOUT                 7
#define CIDBIO_PARAM_MIFARE_BYTE_ORDER              8
#define CIDBIO_PARAM_RFID_BYTE_ORDER                9
#define CIDBIO_PARAM_SEND_ENTER_HID                 10
#define CIDBIO_PARAM_OUTPUT_FORMAT_HID              11
#define CIDBIO_PARAM_ASK_SHIFT_AREA                 12
#define CIDBIO_PARAM_MIFARE_AUTH_TYPE               13
#define CIDBIO_PARAM_MIFARE_AUTH_KEY                14
#define CIDBIO_PARAM_MIFARE_TARGET_SECTOR           15
#define CIDBIO_PARAM_MIFARE_TARGET_BLOCK            16

/**
 * @enum Baudrates
 * @brief Valid Baurates values
 * @see CIDBIO_SetSerialBaudrate
 *
 */

#define CIDBIO_BAUD_110                             110
#define CIDBIO_BAUD_300                             300
#define CIDBIO_BAUD_1200                            1200
#define CIDBIO_BAUD_2400                            2400
#define CIDBIO_BAUD_4800                            4800
#define CIDBIO_BAUD_9600                            9600
#define CIDBIO_BAUD_19200                           19200
#define CIDBIO_BAUD_38400                           38400
#define CIDBIO_BAUD_57600                           57600
#define CIDBIO_BAUD_115200                          115200
#define CIDBIO_BAUD_230400                          230400
#define CIDBIO_BAUD_460800                          460800
#define CIDBIO_BAUD_500000                          500000
#define CIDBIO_BAUD_576000                          576000
#define CIDBIO_BAUD_921600                          921600
#define CIDBIO_BAUD_1000000                         1000000
#define CIDBIO_BAUD_1152000                         1152000

/**
 * @enum Return Codes
 * @brief Values used to identify errors and warnings
 * WARNING  -   Positive
 * SUCCESS  -   Zero
 * ERROR    -   Negative
 */

#define CIDBIO_WARNING_OVERWRITING_TEMPLATE         3
#define CIDBIO_WARNING_NO_IDS_ON_DEVICE             2
#define CIDBIO_WARNING_ALREADY_INIT                 1

#define CIDBIO_SUCCESS                              0

#define CIDBIO_ERROR_UNKNOWN                       -1
#define CIDBIO_ERROR_NO_DEVICE                     -2
#define CIDBIO_ERROR_NULL_ARGUMENT                 -3
#define CIDBIO_ERROR_INVALID_ARGUMENT              -4
#define CIDBIO_ERROR_CAPTURE                       -5
#define CIDBIO_ERROR_CAPTURE_TIMEOUT               -6
#define CIDBIO_ERROR_COMM_USB                      -7
#define CIDBIO_ERROR_IO_ON_HOST                    -8
#define CIDBIO_ERROR_TEMPLATE_ALREADY_ENROLLED     -9
#define CIDBIO_ERROR_MERGING                      -10
#define CIDBIO_ERROR_MATCHING                     -11
#define CIDBIO_ERROR_INVALID_FW_FILE              -12
#define CIDBIO_ERROR_NO_SPACE_LEFT_ON_DEVICE      -13
#define CIDBIO_ERROR_NO_TEMPLATE_WITH_ID          -14
#define CIDBIO_ERROR_INVALID_ERRNO                -15
#define CIDBIO_ERROR_UNAVAILABLE_FEATURE          -16
#define CIDBIO_ERROR_PREVIOUS_FW_VERSION          -17
#define CIDBIO_ERROR_NOT_IDENTIFIED               -18
#define CIDBIO_ERROR_BUSY                         -19
#define CIDBIO_ERROR_CAPTURE_CANCELED             -20
#define CIDBIO_ERROR_NO_FINGER_DETECTED           -21
#define CIDBIO_ERROR_INVALID_TEMPLATE             -22

#endif
