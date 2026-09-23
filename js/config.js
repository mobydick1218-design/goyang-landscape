/* =========================================================
   사이트 설정 — 여기만 고치면 되는 값들
   ========================================================= */
window.CONFIG = {
  title: '고양시 대표경관자원',
  intro: '지도의 자원 점을 누르면 대표사진과 설명, 자원 경계가 표시됩니다.',

  // 사진 주소 앞부분. CSV 사진 칸에 파일명만 적은 경우 이 주소가 앞에 붙습니다.
  // 예) R2로 옮긴 뒤: 'https://pub-xxxx.r2.dev/'  →  VP-006_01.jpg → https://pub-xxxx.r2.dev/VP-006_01.jpg
  // 구글 드라이브 링크나 https:// 로 시작하는 전체 주소는 그대로 사용합니다.
  photoBaseUrl: '',

  // 파일 이름 규칙
  resourceFile: 'Resource_all',   // 자원 대표점 SHP 이름 (CSV file_name 칸과 같아야 함)

  // 요소 구분 (SHP class 칸 / code 앞부분 기준)
  classes: {
    VP:  { label: '조망점',   color: '#7048e8' },
    LE:  { label: '구성요소', color: '#e8590c' },
    BE:  { label: '배경요소', color: '#1971c2' },
    ETC: { label: '기타',     color: '#6c757d' }
  },

  resourceColor: '#0b7285',

  basemaps: {
    normal: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 20
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Imagery &copy; Esri',
      maxZoom: 19,
      labels: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png'
    }
  }
};
