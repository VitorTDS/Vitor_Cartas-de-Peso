/*
 * iDBio.h
 *
 *  Created on: 28 de mai de 2018
 *      Author: joao
 */

#ifndef IDBIO_HPP_
#define IDBIO_HPP_

#include <cidbiolib.h>
#include <cstdint>
#include <string>
#include <vector>

class iDBio {
public:
    static int32_t SetSerialCommPort(const std::string& commPort) {
        return CIDBIO_SetSerialCommPort(commPort.c_str());
    }
    
    static int32_t Init() {
        return CIDBIO_Init();
    }

    static int32_t Terminate() {
        return CIDBIO_Terminate();
    }

    int32_t CaptureAndIdentify(int64_t& id, int32_t& score, int32_t& quality) {
        return CIDBIO_CaptureAndIdentify(&id, &score, &quality);
    }

    int32_t CaptureImage(std::vector<byte>& imageBuf, uint32_t& width, uint32_t& height) {
        byte *pImage;
        int32_t retCode = CIDBIO_CaptureImage(&pImage, &width, &height);
        imageBuf = copy_and_delete(pImage, width*height);
        return retCode;
    }
    
    int32_t CheckFingerprint(std::vector<byte>& imageBuf, uint32_t& width, uint32_t& height) {
	    byte *pImage;
	    int32_t retCode = CIDBIO_CheckFingerprint(&pImage, &width, &height);
	    imageBuf = copy_and_delete(pImage, width*height);
	    return retCode;
    }

    int32_t CaptureAndEnroll(const int64_t id) {
        return CIDBIO_CaptureAndEnroll(id);
    }

    int32_t CaptureImageAndTemplate(std::string& t, std::vector<byte>& imageBuf, uint32_t& width, uint32_t& height, int32_t& quality) {
        byte *pImage;
        char *pTemplate;
        int32_t retCode = CIDBIO_CaptureImageAndTemplate(&pTemplate, &pImage, &width, &height, &quality);
        t = copy_and_delete(pTemplate);
        imageBuf = copy_and_delete(pImage, width*height);
        return retCode;
    }

    int32_t CaptureAndMatch(const int64_t id, int32_t& score, int32_t& quality) {
        return CIDBIO_CaptureAndMatch(id, &score, &quality);
    }

    int32_t GetTemplate(const int64_t id, std::string& t) {
        char* pTemplate;
        int32_t retCode = CIDBIO_GetTemplate(id, &pTemplate);
        t = copy_and_delete(pTemplate);
        return retCode;
    }

    int32_t ExtractTemplateFromImage(uint32_t width, uint32_t height, const std::vector<byte>& image, std::string& t, int32_t& quality) {
        char *pTemplate;
        int32_t retCode = CIDBIO_ExtractTemplateFromImage(width, height, image.data(), &pTemplate, &quality);
        t = copy_and_delete(pTemplate);
        return retCode;
    }

    int32_t DeleteTemplate(int64_t id) {
        return CIDBIO_DeleteTemplate(id);
    }

    int32_t DeleteAllTemplates() {
        return CIDBIO_DeleteAllTemplates();
    }

    int32_t MergeTemplates(const std::string& t1, const std::string& t2, const std::string& t3, std::string& tFinal) {
        char *pTemplateFinal;
        int32_t retCode = CIDBIO_MergeTemplates(t1.c_str(), t2.c_str(), t3.c_str(), &pTemplateFinal);
        tFinal = copy_and_delete(pTemplateFinal);
        return retCode;
    }

    int32_t MatchTemplates(const std::string& t1, const std::string& t2, int32_t& score) {
        return CIDBIO_MatchTemplates(t1.c_str(), t2.c_str(), &score);
    }

    int32_t GetTemplateIDs(std::vector<int64_t>& ids) {
        int64_t *pIds;
        uint32_t len = 0;
        int32_t retCode = CIDBIO_GetTemplateIDs(&pIds, &len);
        ids = copy_and_delete(pIds, len);
        return retCode;
    }

    int32_t MatchTemplateByID(const int64_t id, const std::string& t, int32_t& score) {
        return CIDBIO_MatchTemplateByID(id, t.c_str(), &score);
    }

    int32_t SaveTemplate(int64_t id, const std::string& t) {
        return CIDBIO_SaveTemplate(id, t.c_str());
    }

    int32_t SetParameter(int32_t config, const std::string& value) {
        return CIDBIO_SetParameter(config, value.c_str());
    }

    int32_t GetParameter(int32_t config, std::string& value) {
        char *pValue;
        int32_t retCode = CIDBIO_GetParameter(config, &pValue);
        value = copy_and_delete(pValue);
        return retCode;
    }

    int32_t GetDeviceInfo(std::string& version, std::string& serialNumber, std::string& model) {
        char *pVersion, *pSerialNumber, *pModel;
        int32_t retcode = CIDBIO_GetDeviceInfo(&pVersion, &pSerialNumber, &pModel);
        version         = copy_and_delete(pVersion);
        serialNumber    = copy_and_delete(pSerialNumber);
        model           = copy_and_delete(pModel);
        return retcode;
    }

    int32_t UpdateFirmware(const std::string& filePath) {
        return CIDBIO_UpdateFirmware(filePath.c_str());
    }

    int32_t CancelCapture(void) {
        return CIDBIO_CancelCapture();
    
    }
    
    static int32_t GetErrorMessage(const int32_t error, std::string& msg) {
        char *pMessage;
        int32_t retCode = CIDBIO_GetErrorMessage(error, &pMessage);
        msg = copy_and_delete(pMessage);
        return retCode;
    }

    static int32_t FreeByteArray(byte*const     array) {
        return CIDBIO_FreeByteArray(array);
    }

    static int32_t FreeString   (char*const     array) {
        return CIDBIO_FreeString(array);
    }

    static int32_t FreeIDArray  (int64_t*const  array) {
        return CIDBIO_FreeIDArray(array);
    }

    int32_t GetBlockData(std::string& block_data) {
        char *pBlockData;
        int32_t retCode = CIDBIO_GetBlockData(&pBlockData);
        block_data = copy_and_delete(pBlockData);
        return retCode;
    }

    int32_t SetBlockData(const std::string& block_data) {
        return CIDBIO_SetBlockData(block_data.c_str());
    }

    int32_t SetAuthKey(const std::string& auth_key) {
        return CIDBIO_SetAuthKey(auth_key.c_str());
    }

private:

    static inline std::string copy_and_delete(char*const ptr) {
        if(ptr == NULL)
            return std::string();
        std::string str(ptr);
        CIDBIO_FreeString(ptr);
        return str;
    }

    static inline std::vector<byte> copy_and_delete(byte*const ptr, size_t length) {
        if(ptr == NULL)
            return std::vector<byte>();
        std::vector<byte> vec(length);
        std::copy(&ptr[0], &ptr[length], vec.begin());
        CIDBIO_FreeByteArray(ptr);
        return vec;
    }

    static inline std::vector<int64_t> copy_and_delete(int64_t*const ptr, size_t length) {
        if(ptr == NULL)
            return std::vector<int64_t>();
        std::vector<int64_t> vec(length);
        std::copy(&ptr[0], &ptr[length], vec.begin());
        CIDBIO_FreeIDArray(ptr);
        return vec;
    }

};

#endif /* IDBIO_HPP_ */
