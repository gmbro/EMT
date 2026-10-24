// Pinned, quantized assets. Meeting audio and text are never sent to a model host.
export const MODEL_CATALOG = Object.freeze({
  "speech": {
    "id": "onnx-community/whisper-base",
    "revision": "1846881b6b3a3024392c1eea3ad983695bc23925",
    "localId": "whisper-base-1846881b",
    "label": "한국어·영어 음성 인식 (Whisper Base)",
    "bytes": 81294765
  },
  "koToEn": {
    "id": "Xenova/opus-mt-ko-en",
    "revision": "d9fa1ac6008242100fecb4fff9b0a5917a1be81f",
    "localId": "opus-ko-en-d9fa1ac6",
    "label": "한국어 → 영어 번역 (OPUS-MT)",
    "bytes": 123110122
  },
  "multilingual": {
    "id": "Xenova/m2m100_418M",
    "revision": "9c374f0b7aca709787cea97b047bfbbd1559d177",
    "localId": "m2m100-9c374f0b",
    "label": "영어 ↔ 한국어 번역 (M2M100)",
    "bytes": 646113002
  }
});

// Consumed by scripts/prepare-models.mjs; all files are served from this site.
export const MODEL_ASSETS = Object.freeze({
  "speech": [
    {
      "path": "README.md",
      "bytes": 531,
      "sha256": "60a378018182c57cf382866ddfbf0fb2b4031b3895ae932aa34ecb8ff7065a13"
    },
    {
      "path": "added_tokens.json",
      "bytes": 34604,
      "sha256": "9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1"
    },
    {
      "path": "config.json",
      "bytes": 2243,
      "sha256": "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b"
    },
    {
      "path": "generation_config.json",
      "bytes": 3832,
      "sha256": "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0"
    },
    {
      "path": "merges.txt",
      "bytes": 493869,
      "sha256": "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6"
    },
    {
      "path": "normalizer.json",
      "bytes": 52666,
      "sha256": "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd"
    },
    {
      "path": "onnx/decoder_model_merged_quantized.onnx",
      "bytes": 53693315,
      "sha256": "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b"
    },
    {
      "path": "onnx/encoder_model_quantized.onnx",
      "bytes": 23201314,
      "sha256": "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46"
    },
    {
      "path": "preprocessor_config.json",
      "bytes": 339,
      "sha256": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"
    },
    {
      "path": "quantize_config.json",
      "bytes": 10126,
      "sha256": "6e0e27f293a5c17ff2ca8046f06079c0120aa2ede6456faac8ec4b3203471a55"
    },
    {
      "path": "special_tokens_map.json",
      "bytes": 2194,
      "sha256": "e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691"
    },
    {
      "path": "tokenizer.json",
      "bytes": 2480466,
      "sha256": "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"
    },
    {
      "path": "tokenizer_config.json",
      "bytes": 282682,
      "sha256": "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573"
    },
    {
      "path": "vocab.json",
      "bytes": 1036584,
      "sha256": "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a"
    }
  ],
  "koToEn": [
    {
      "path": "README.md",
      "bytes": 571,
      "sha256": "1fd9507c42a9b9ffb7933afd3d2740ed35521c708c174ea21db9da42a3d7e45e"
    },
    {
      "path": "config.json",
      "bytes": 1389,
      "sha256": "8260080db48141328ae198ede2b25483fa4a6f46dc2859784d6e21c188865e43"
    },
    {
      "path": "generation_config.json",
      "bytes": 293,
      "sha256": "8dc29fef0fe82109f94ef3c2e6ea6bded3215d357b226c34cf7b4630726766c9"
    },
    {
      "path": "onnx/decoder_model_merged_quantized.onnx",
      "bytes": 60212803,
      "sha256": "e131732653a6d3cec42a8b65f8844980042b036bdaca931446bc4b3530bc3506"
    },
    {
      "path": "onnx/encoder_model_quantized.onnx",
      "bytes": 52899741,
      "sha256": "210e1d2cb5b457cdeeffe288099cc9d1df9f13c35dc3d39fde4ba252af877380"
    },
    {
      "path": "quantize_config.json",
      "bytes": 3124,
      "sha256": "abfc1fe535d5229e493cebd396dd5952842975dd6e333c67eb3539d58ff21390"
    },
    {
      "path": "source.spm",
      "bytes": 841805,
      "sha256": "c9496f7c2be9aecb84c751ae9f35a875915dde8e3892f652a5c76811ab2a0f49"
    },
    {
      "path": "special_tokens_map.json",
      "bytes": 74,
      "sha256": "5e4d1f5e759d74cb1c2fe1d165cfc62b5237aa904de759380cd6f43042eec723"
    },
    {
      "path": "target.spm",
      "bytes": 813126,
      "sha256": "f1531ac8576fe64267dfca0dc33950a6e9a2d3fd9e05346558ad7ea5ee0e65bf"
    },
    {
      "path": "tokenizer.json",
      "bytes": 6487044,
      "sha256": "147a41edd62b08c79be8cfe6d3102ad19d8a964ac061b4bd6840ac45d0112011"
    },
    {
      "path": "tokenizer_config.json",
      "bytes": 282,
      "sha256": "3df327b013e1fd1a7c7423a3c521d325cb0e641044f5ced6d2ec44ab811b4f0e"
    },
    {
      "path": "vocab.json",
      "bytes": 1849870,
      "sha256": "97197044d4803c664a37f8ca2ced9c3405b8a3df6b262a12da22d990b0d756cd"
    }
  ],
  "multilingual": [
    {
      "path": "README.md",
      "bytes": 559,
      "sha256": "fc4c4aeac92d17f16d5e94e6a36779e5b9e7bec98f470d38ea7b4a3fb3d9de8e"
    },
    {
      "path": "config.json",
      "bytes": 908,
      "sha256": "1dbdf77ddc7809acd4c54ccf0eab46f840b40174afb1b6f6de8787244e832938"
    },
    {
      "path": "generation_config.json",
      "bytes": 233,
      "sha256": "722210dd0bee7bef4e8e7f9a8574d8c56a2dfff723d73f390ce67892740b9009"
    },
    {
      "path": "onnx/decoder_model_merged_quantized.onnx",
      "bytes": 344128178,
      "sha256": "007654bcabb6cea6fd3bde34ce933137b431330b3755781145d7b6906270b45a"
    },
    {
      "path": "onnx/encoder_model_quantized.onnx",
      "bytes": 287856370,
      "sha256": "13a94e354a9140764eb81102d77d3ec6952d796e6f113c651eeb3c3443da0386"
    },
    {
      "path": "quantize_config.json",
      "bytes": 3370,
      "sha256": "db45915f44ebe0ccacbc75c8a58b43c72f7fd18bf8d1b4520b7b557114bf81cf"
    },
    {
      "path": "sentencepiece.bpe.model",
      "bytes": 2423393,
      "sha256": "d8f7c76ed2a5e0822be39f0a4f95a55eb19c78f4593ce609e2edbc2aea4d380a"
    },
    {
      "path": "special_tokens_map.json",
      "bytes": 1559,
      "sha256": "009ea667e0ca903c10dac22cf7ae3a3a0b173ff33f8c64154fddd8c043805622"
    },
    {
      "path": "tokenizer.json",
      "bytes": 7988527,
      "sha256": "03d9e111731c2d71f39a2c2a88499743e4c251385d07f0384b4349a23ba54363"
    },
    {
      "path": "tokenizer_config.json",
      "bytes": 1813,
      "sha256": "bacfd4b9da25a61e01f17abe660465f616c9a1a3f5e23ab9ad3326c3788f2d9f"
    },
    {
      "path": "vocab.json",
      "bytes": 3708092,
      "sha256": "b6e77e474aeea8f441363aca7614317c06381f3eacfe10fb9856d5081d1074cc"
    }
  ]
});
