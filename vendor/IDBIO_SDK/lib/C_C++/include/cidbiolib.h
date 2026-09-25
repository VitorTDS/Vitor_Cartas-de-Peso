#ifndef CIDBIOLIB_H_
#define CIDBIOLIB_H_

#include "cidbioconf.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
* @brief Serial Port Configuration
* @param[in]    commPort        :   Serial Port path string (COMx | /dev/ttyACMx)
* @return
*       @retval return Code     :   @see CIDBIO_ERRORS
*/
CIDBIOLIB_API int32_t STDCALL CIDBIO_SetSerialCommPort(const char*const commPort);

/**
 * @brief Initialization function. It checks device connection.
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_Init(void);

/**
 * @brief Termination function.
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_Terminate(void);

/**
 * @brief Captures fingerprint image
 * @param[out]  imageBuf    :   Bitmap buffer of image content
 * @param[out]  width       :   Width of image
 * @param[out]  height      :   Height of image
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_CaptureImage(byte**const imageBuf, uint32_t*const width, uint32_t*const height);

/**
 * @brief Checks for a fingerprint on the sensor. If there is one, returns it immediately
 * @param[out]  imageBuf    :   Bitmap buffer of image content
 * @param[out]  width       :   Width of image
 * @param[out]  height      :   Height of image
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_CheckFingerprint(byte**const imageBuf, uint32_t*const width, uint32_t*const height);

/**
 * @brief Captures fingerprint image and extract its template
 * @param[out]  t           :   Base64 fingerprint template
 * @param[out]  imageBuf    :   Bitmap buffer of image content
 * @param[out]  width       :   Width of image
 * @param[out]  height      :   Height of image
 * @param[out]  quality     :   Value in range [0,100] for measuring fingerprint quality
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_CaptureImageAndTemplate(char**const t, byte**const imageBuf, uint32_t*const width, uint32_t*const height, int32_t*const quality);

/**
 * @brief Captures fingerprint and enroll with id
 * @param[in] id            :   Template identification number
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_CaptureAndEnroll(const int64_t id);

/**
 * @brief Captures fingerprint and try identifying with any template.
 * @param[out]  id          :   Template identification number
 * @param[out]  score       :   Value in range [0,20000] for measuring fingerprint matching
 * @param[out]  quality     :   Value in range [0,100] for measuring fingerprint quality
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_CaptureAndIdentify(int64_t*const id, int32_t*const score, int32_t*const quality);

/**
 * @brief Captures fingerprint and try identifying with one template.
 * @param[in]   id          :   Template identification number
 * @param[out]  score       :   Value in range [0,20000] for measuring fingerprint matching
 * @param[out]  quality     :   Value in range [0,100] for measuring fingerprint quality
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_CaptureAndMatch(const int64_t id, int32_t*const score, int32_t*const quality);


/**
 * @brief Extracts a template from a image
 * @param[in]   width       :   Width of image
 * @param[in]   height      :   Height of image
 * @param[in]   imageBuf    :   Bitmap buffer of image content
 * @param[out]  t           :   Base64 fingerprint template
 * @param[out]  quality     :   Value in range [0,100] for measuring fingerprint quality
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_ExtractTemplateFromImage(uint32_t width, uint32_t height, const byte*const imageBuf, char**const t, int32_t*const quality);

/**
 * @brief Merges three templates
 * @param[in]   t1          :   Base64 fingerprint template
 * @param[in]   t2          :   Base64 fingerprint template
 * @param[in]   t3          :   Base64 fingerprint template
 * @param[out]  tFinal      :   Base64 fingerprint template
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_MergeTemplates(const char*const t1, const char*const t2, const char*const t3, char**const tFinal);

/**
 * @brief Matches two templates
 * @param[in]   t1          :   Base64 fingerprint template
 * @param[in]   t2          :   Base64 fingerprint template
 * @param[out]  score       :   Value in range [0,20000] for measuring fingerprint matching
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_MatchTemplates(const char*const t1, const char*const t2, int32_t*const score);

/**
 * @brief Matches a template with a enrolled template
 * @param[in]   id          :   Template identification number
 * @param[in]   t           :   Base64 fingerprint template
 * @param[out]  score       :   Value in range [0,20000] for measuring fingerprint matching
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_MatchTemplateByID(const int64_t id, const char*const t, int32_t*const score);

/**
 * @brief Gets all Ids enrolled in device
 * @param[out]  ids         :   Array of ids enrolled in device
 * @param[out]  len         :   Length of ids array
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_GetTemplateIDs(int64_t**const ids, uint32_t*const len);

/**
 * @brief Gets a template
 * @param[in]   id          :   Template identification number
 * @param[out]  t           :   Base64 fingerprint template
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_GetTemplate(const int64_t id, char**const t);

/**
 * @brief Saves a template in device
 * @param[in] id            :   Template identification number
 * @param[in] t             :   Base64 fingerprint template
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_SaveTemplate(int64_t id, const char*const t);

/**
 * @brief Deletes a template on this device
 * @param[in]   id          :   Template identification number
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_DeleteTemplate(int64_t id);

/**
 * @brief Deletes All templates in device
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_DeleteAllTemplates(void);

/**
 * @brief Changes a device parameter value
 * @param[in]   config      :	Enumaration of parameter
 * @param[in]   value		:	Parameter value
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_SetParameter(int32_t config, const char*const value);

/**
 * @brief Gets a device parameter value
 * @param[in]   config      :   Enumaration of parameter
 * @param[out]  value       :   Parameter value
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_GetParameter(int32_t config, char**const value);

/**
 * @brief Gets Information for identifying device
 * @param[out]  version     :   Firmware version
 * @param[out]  serialNumber:   Device's serial number
 * @param[out]  model       :   Device's model
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_GetDeviceInfo(char**const version, char**const serialNumber, char**const model);

/**
 * @brief Updates device's firmware
 * @param filename	        :	File path to firmware file
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_UpdateFirmware(const char*const filePath);

/**
 * @brief Cancel an ongoing capture
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_CancelCapture(void);

/**
 * @brief Sets the serial port baudrate
 * @param[in]   baudrate	:   New baudrate
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_SetSerialBaudrate(int32_t baudrate);

/**
 * @brief Gets error description message
 * @param[in]   error       :   Enumeration of errors @see CIDBIO_ERRROS
 * @param[out]  msg         :   Error description message
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_GetErrorMessage(const int32_t error, char**const msg);

/**
 * @brief Memory deallocation functions
 * @param[in]   array       :   Array to be deallocated
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_FreeByteArray(byte*const     array);
CIDBIOLIB_API int32_t STDCALL CIDBIO_FreeString   (char*const     array);
CIDBIOLIB_API int32_t STDCALL CIDBIO_FreeIDArray  (int64_t*const  array);

/**
 * @brief Get block data from Mifare card
 * @param[out]  block_data  :   Block data as hex string (32 characters = 16 bytes)
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_GetBlockData(char**const block_data);

/**
 * @brief Set block data on Mifare card
 * @param[in]   block_data  :   Block data as hex string (32 characters = 16 bytes, no 0x prefix)
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_SetBlockData(const char*const block_data);

/**
 * @brief Set authentication key on Mifare card
 * @param[in]   key         :   key string in base64 (8 characters)
 * @return
 *      @retval return Code      :   @see CIDBIO_ERRORS
 */
CIDBIOLIB_API int32_t STDCALL CIDBIO_SetAuthKey(const char*const auth_key);


#ifdef __cplusplus
}
#endif

#endif
