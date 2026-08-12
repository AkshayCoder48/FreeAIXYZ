# Dreemy models + image-gen codes

Pulled live 2026-08-12 from `/api/dict`, `/api/msg/getAllChatModels`, `/api/aiImage/template/{id}`, `/api/home/features`, and confirmed creates.

---

## Image models (`modelId`)

Only **two** image models exist. CDN icons exist for `logo1` and `logo2` only. `modelId=99` → `Model not found or disabled`.

| modelId | name | icon | default 2K fee | notes |
|---|---|---|---|---|
| **1** | Dreemy AI | `ai_model_logo1.png` | **40** | Safer / default. Job `permission=2` (private) when no template. |
| **2** | Dreemy Spicy 🌶💋 | `ai_model_logo2.png` | **20** | The one in your original capture. |

There is **no** public “list models” endpoint. The server validates `modelId` on create.

---

## Image create API

| method | path | required | what it is |
|---|---|---|---|
| POST | `/api/aiImage/create` | `prompt` | v1, no `modelId` |
| POST | `/api/aiImage/create/v2` | `prompt` + `modelId` | current web path |
| GET | `/api/aiImage/{id}` | numeric job id | poll job |
| GET | `/api/aiImage/template/{id}` | numeric template id | template preset |

v2 body (your working shape):

```json
{
  "prompt": "cutegirlanime",
  "resolution": "2K",
  "number": 1,
  "aspectRatio": "1:1",
  "modelId": 2,
  "imageUrls": [],
  "resourceId": 44,
  "resourceType": "3",
  "permission": "1"
}
```

| field | meaning |
|---|---|
| `prompt` | required, max 1000 (chat-to-image UI) / 5000 (standalone page) |
| `modelId` | `1` or `2` |
| `resolution` | seen: `2K` (default if omitted). VIP copy also mentions higher. |
| `aspectRatio` | e.g. `1:1` (echoed back as `radio`) |
| `number` | how many images, usually `1` |
| `imageUrls` | source images for img2img (`scene=6`) |
| `resourceId` | template id (see below) |
| `resourceType` | see enum |
| `permission` | `1` public / `2` private |

Accepted job envelope: HTTP 200, `data.code=1`, `data.result.id`, `status=1`.  
Poll until `status=2` and `resultImages[]` is filled.  
`data.code=-1` / `-5` = rejected (quota / rate), still HTTP 200.

Video twin: `POST /api/aiVideo/create/v2` requires `prompt` + `modelId` + `resolution`.

---

## Image-gen codes (`GET /api/dict`)

### `AiFeatureScene` — `scene` on the job / template

| value | name | used for |
|---|---|---|
| 1 | `text_to_video` | T2V |
| 2 | `image_to_video` | I2V |
| 3 | `ai_kiss` | kiss |
| 4 | `ai_hug` | hug |
| 5 | `face_swap` | face swap |
| 6 | `image_to_image` | img2img templates 1–22, 64–65 |
| 7 | `image_to_video_template` | dance / cloth_remover / etc. |
| **8** | **`text_to_image`** | your jobs + templates 23–63 |

### `AiImageResourceType` — `resourceType`

| value | name |
|---|---|
| 1 | `ai_image` |
| 2 | `chat` |
| **3** | **`template`** ← your `resourceType:"3"` + `resourceId:44` |
| 4 | `image` |

### `AiImagePermissionType` — `permission`

| value | name |
|---|---|
| 1 | Public |
| 2 | Private |

### `AiImageResultStatus` — job `status`

| value | name |
|---|---|
| 1 | pending |
| 2 | success |
| 3 | failed |

### `AiGenerationType`

| 1 | IMAGE | 2 | VIDEO |

---

## Image templates (`resourceType=3`)

`GET /api/aiImage/template/{id}` → `{id, code, title, scene, prompt, requireImgCount, previewImage}`.

### scene 6 — image-to-image (need `imageUrls`, `requireImgCount=1`)

| id | code | title |
|---|---|---|
| 1 | `cloth-remover` | Cloth Remover |
| 2 | `breast-expansion` | Breast Expansion |
| 3 | `clay-ai` | Clay |
| 4 | `pixar-ai-generator` | Pixar |
| 5 | `studio-ghibli-ai` | Ghibli |
| 6 | `pixel-art-ai` | Pixel Art |
| 7 | `ai-knitting-filter` | Knitting Filter |
| 8 | `puppet-ai` | Puppet |
| 9 | `gta-ai-generator` | GTA |
| 10 | `ai-caricature-generator` | Caricature |
| 11 | `ai-cartoon-generator` | Cartoon |
| 12 | `ai-photo-to-painting` | Painting |
| 13 | `change-clothes-ai-photo` | Clothes Changer |
| 14 | `ai-hairstyle-changer` | Hairstyle Changer |
| 15 | `ai-avatar-generator` | Avatar |
| 16 | `ai-headshot-generator` | Headshot |
| 17 | `eye-color-ai` | Eye Color |
| 18 | `ai-fat-filter` | Fat |
| 19 | `ai-3d-model-generator` | 3D Comic |
| 20 | `ai-comic-generator` | Comic Book |
| 21 | `ai-action-figure-image` | Action Figure |
| 22 | `ai-mount-rushmore-generator` | Moutain Rushmore |
| 64 | `undress-photo` | Undress Photo |
| 65 | `ai-porn-image-generator` | AI Porn Image Generator |

### scene 8 — text-to-image style presets (ids 23–63 = `text_to_image_1` … `_41`)

Your capture used **id 44 = `text_to_image_22`**. These are prompt-style seeds, not separate models. You still pick `modelId` 1 or 2.

| id | code |
|---|---|
| 23 | `text_to_image_1` |
| 24 | `text_to_image_2` |
| … | … |
| **44** | **`text_to_image_22`** |
| 63 | `text_to_image_41` |

Full dump: `dreemy_templates.json`.

---

## Discovery features (`GET /api/home/features`)

These are **product tiles**, not `modelId`s. Fees are list prices (actual T2I 2K was 20/40).

| id | title | jumpPath | jumpParams | list fee |
|---|---|---|---|---|
| 8 | Face Swap | `/face_swap` | | 100 |
| 7 | AI Images | `/ai_image` | | 40 |
| 3 / 9 | Text To Video | `/ai_video` | | 100 |
| 4 / 10 | Image To Video | `/image_to_video` | | 100 |
| 13 | Cloth Remover | `/image_to_video_template` | `templateCode=cloth_remover` | 100 |
| 14 | AI Twerk | `/image_to_video_template` | `ai_twerk` | 100 |
| 15 | AI Giggle | `/image_to_video_template` | `ai_giggle` | 100 |
| 16 | AI Bikini | `/image_to_video_template` | `ai_bikini` | 100 |
| 17 | AI Hipshake | `/image_to_video_template` | `ai_hipshake` | 100 |
| 19 | Dance | `/image_to_video_template` | `dance` | 100 |
| 20 | Hip Shake | `/image_to_video_template` | `hip_shake` | 100 |
| 21 | Muscle | `image_to_video_template` | `muscle` | 100 |
| 22 | Cloth Changer | `/image_to_video_template` | `cloth_changer` | 100 |
| 23 | Tattoo | `/image_to_video_template` | `tattoo` | 100 |
| 24 | Gender Swap | `/image_to_video_template` | `gender_swap` | 100 |
| 11 | AI Kiss | `/ai_kiss` | | 100 |
| 12 | AI Hug | `/ai_hug` | | 100 |
| 25 | Baby Generator | `/image_to_video_template` | `baby_generator` | 100 |
| 26 | Flying | `/image_to_video_template` | `flying` | 100 |
| 27 | Squish | `/image_to_video_template` | `squish` | 100 |
| 28 | Love Heart | `/image_to_video_template` | `love_heart` | 100 |
| 30 | Fight | `/image_to_video_template` | `fight` | 100 |
| 31 | Princess Carry | `/image_to_video_template` | `princess_carry` | 100 |
| 32 | Handshake | `/image_to_video_template` | `ai_handshake` | 100 |

Video template codes also live at `GET /api/aiVideo/template/{1–60}` (`dreemy_video_templates.json`).

---

## Chat models (`GET /api/msg/getAllChatModels`)

Different IDs from image `modelId`. Used only in `/api/msg/send`.

| id | title | vipLevel | default |
|---|---|---|---|
| 14 | Dreemy AI Flash | free | **yes** |
| 1 | Dreemy AI | free | |
| 11 | Dreemy AI Lite | free | |
| 13 | Qwen Flash | free | |
| 2 | Mistral Nemo | free | |
| 12 | Qwen Plus | 1 Standard | |
| 4 | Mythomax | 1 | |
| 9 | Grok4 Fast | 2 Premium | |
| 5 | Qwen3 | 2 | |
| 6 | WizardLM | 2 | |
| 10 | SkyLark Pro | 3 Deluxe | |
| 7 | Euryale | 3 | |
| 8 | Deepseek | 3 | |

Chat memory lengths (`GET /api/msg/getAllChatMemoryLengths`): `1=2K` free, `2=4K` VIP1, `3=16K` VIP2, `4=32K` VIP3.

---

## Related endpoints

| method | path |
|---|---|
| POST | `/api/auth/createGuest` |
| POST | `/api/auth/loginByGuest` |
| GET | `/api/auth/getAccount` |
| GET | `/api/auth/getAccountIntegral` |
| GET | `/api/dict` |
| GET | `/api/home/features` |
| GET | `/api/home/getFeaturesByCategory` |
| GET | `/api/msg/getAllChatModels` |
| POST | `/api/stat/useTextToImage` (analytics only) |
| POST | `/api/stat/useImageToVideo` |
| POST | `/api/stat/useImageFaceSwap` |
| POST | `/api/stat/useAiKiss` |
| POST | `/api/stat/useAiHug` |
| POST | `/api/upload/uploadTempFile` |

Minimal T2I (same as your first call):

```
POST /api/aiImage/create/v2
x-auth-token: <guest idToken>
x-finger: <32-hex>
modelId=2, resourceType="3", resourceId=44, scene implied 8, resolution=2K
```
