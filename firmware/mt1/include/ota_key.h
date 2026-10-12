// The public key the firmware trusts for updates (decision 064). Development builds trust the public development key
// (firmware/scripts/sign.mjs --dev); release builds the release key, passed in at build time and never committed.
#pragma once

#if defined(FOS_DEV_BUILD)
#define FOS_OTA_KEY_B64 "YWTjNFutMlWqyA5T8NiLkQqw10XuZzYqORfT84H1snY="
#elif defined(FOS_OTA_PUBKEY)
#define FOS_OTA_KEY_B64 FOS_OTA_PUBKEY
static_assert(sizeof(FOS_OTA_PUBKEY) == 45, "Set MT1_RELEASE_PUBKEY to the release public key (44 base64 characters)");
#else
#error "Build esp32s3-dev, or esp32s3-release with MT1_RELEASE_PUBKEY set"
#endif
