/* ===== 사이트 설정 (여기만 바꾸면 됩니다) ===== */
window.SITE_CONFIG = {
  // 카카오맵 JavaScript 키
  KAKAO_KEY: "5831685a43dbc3c5aebaa333c9a2fd3e",

  // 사진 주소 앞부분.
  //  - 지금: 사이트 안의 photos 폴더 → "photos/"
  //  - R2로 옮긴 뒤: R2 공개 주소로 바꾸기 → 예) "https://pub-xxxx.r2.dev/photos/"
  // CSV에는 파일명만 적고, 여기 주소가 자동으로 앞에 붙습니다.
  PHOTO_BASE: "",

  // 지도에 표시할 자원 (Resource_all의 BD 코드). 자원이 추가되면 여기에 코드만 추가.
  // (세부 조사결과가 없는 자원은 점과 경계만 표시됩니다)
  READY: ["ILP", "BHM", "SOL", "KNX", "HJS", "GNR", "CHR", "GYS", "JAR", "KSM", "JHW", "GBM"],

  // 이름표가 보이기 시작하는 지도 확대 단계 (카카오맵 레벨: 숫자가 작을수록 확대)
  LABEL_LEVEL: 4,

  // 레이어 색상
  COLORS: {
    VP: "#e0592a",   // 조망점
    LE: "#1f8a70",   // 구성요소
    BE: "#3a6ea5",   // 배경요소
    etc: "#7d8590",  // 기타
    BD: "#3d4249",   // 자원 경계 (짙은 회색)
    CITY: "#4b5563", // 고양시 경계
    RES: "#14365c"   // 자원 점
  }
};
