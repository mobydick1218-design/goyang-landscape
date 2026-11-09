# 고양시 대표경관자원 지도

GitHub Pages에 올리는 정적 웹사이트입니다. 이 `site` 폴더 안의 파일을 저장소에 그대로 올리면 됩니다.

## 폴더 구성

| 경로 | 내용 | 직접 수정 |
|---|---|---|
| `index.html`, `css/`, `js/app.js` | 화면과 동작 | ✕ |
| `js/config.js` | 카카오 키, 사진 주소, 표시할 자원, 색상 | ○ |
| `data/resources.csv` | 자원 소개, 현황, 관리 방향, 대표사진 | ○ (엑셀) |
| `data/elements.csv` | 구성요소·배경요소·기타 설명과 사진 | ○ (엑셀) |
| `data/viewpoints.csv` | 조망점 설명과 사진 | ○ (엑셀) |
| `data/geo/*.json` | SHP에서 변환한 지도 데이터 | ✕ (변환 스크립트로 생성) |
| `photos/ILP, BHM, SOL` | 웹용으로 줄인 사진 (위치정보 제거됨) | 사진 추가 시 |

## CSV 수정 방법

- 엑셀에서 열고, 저장할 때 **CSV UTF-8(쉼표로 분리)** 형식으로 저장합니다.
- 요소 설명은 `resource`(ILP/BHM/SOL) + `kind`(LE/BE/etc) + `name`이 SHP의 `class`·`name`과 정확히 같아야 연결됩니다.
- 조망점은 `resource` + `no`(조망점 번호)로 연결됩니다.
- `photos` 칸: 사진 여러 장은 `;`로 구분, 사진 설명은 `|` 뒤에 적습니다.
  `DSL_0082.jpg|명릉 전경;DSL_0093.jpg|숙종, 인현왕후, 인원왕후 능`
- `viewpoints.csv`의 `angle` 칸: 조망 방향 각도입니다. **북쪽 0°, 동쪽 90°, 남쪽 180°, 서쪽 270°**(시계방향). 지도에 이 방향으로 화살표와 시야 부채꼴이 그려집니다. 비워 두면 화살표 없이 번호만 표시됩니다.
- `viewpoints.csv`의 `pano` 칸: 360도 사진 파일명입니다(가로:세로 2:1). 있으면 패널에 360도 뷰어가 나옵니다. 360도 사진은 `tools/build_data.py`가 자동으로 알아보고 `파일명_360.jpg`로 만듭니다.
- 다른 자원 폴더의 사진은 `ILP/IMG_3280.jpg`처럼 폴더를 붙입니다. `https://`로 시작하는 주소(구글 드라이브 링크 포함)도 그대로 쓸 수 있습니다.

## 사진을 Cloudflare R2로 옮길 때

1. R2 버킷에 `photos` 폴더를 통째로 올립니다 (`photos/ILP/...`, `photos/BHM/...`, `photos/SOL/...`).
2. 버킷의 공개 주소를 켭니다 (Settings → Public access → R2.dev subdomain 또는 연결 도메인).
3. `js/config.js`의 `PHOTO_BASE`를 `"https://pub-xxxx.r2.dev/photos/"`처럼 바꿉니다.
4. 저장소에서 `photos` 폴더를 지워도 됩니다. CSV는 바꿀 필요 없습니다.
5. 360도 사진을 R2에서 불러오려면 버킷 Settings → CORS policy에 사이트 주소(`https://사용자명.github.io`)의 GET 요청을 허용해야 합니다. 일반 사진은 이 설정 없이도 보입니다.

## 카카오맵

- `js/config.js`의 `KAKAO_KEY`를 사용합니다.
- Kakao Developers → 내 애플리케이션 → 앱 → 플랫폼 키 → JavaScript 키 → **JavaScript SDK 도메인**에 아래 주소가 등록되어 있어야 지도가 뜹니다.
  - `https://사용자명.github.io`
  - (내 컴퓨터에서 미리보기) `http://localhost:8000`

## 내 컴퓨터에서 미리보기

`index.html`을 더블클릭하면 보안 정책 때문에 데이터가 안 읽힙니다. `site` 폴더에서 아래를 실행한 뒤 http://localhost:8000 으로 엽니다.

```
python -m http.server 8000
```

## SHP를 수정했을 때

상위 폴더의 `tools/build_data.py`가 SHP를 지도 데이터(`data/geo`)로 바꾸고 사진을 줄여 `photos`에 넣습니다.

```
python tools/build_data.py
```

자원 폴더 안에 `{코드}_P`, `{코드}_L`, `{코드}_A`, `{코드}_VP` SHP와 `자원 경계(전체)/{코드}_BD`가 있으면 자동으로 읽습니다.
새 자원을 추가할 때는 `tools/build_data.py`의 `RESOURCES`와 `js/config.js`의 `READY`에 코드를 추가합니다.

## 주소로 바로 열기

- `…/#/SOL` : 서오릉 소개
- `…/#/SOL/d` : 서오릉 세부 조사결과
- `…/#/SOL/SOL_VP_04` : 서오릉 조망점 4
