/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // 한글이 본문의 대부분이다. 지정을 안 하면 윈도우에서 맑은고딕으로 떨어져
        // 자간·굵기가 화면마다 달라진다. Pretendard는 index.css에서 로컬 파일로 싣는다
        sans: ['Pretendard Variable', 'Pretendard', 'system-ui', 'sans-serif'],
      },
      colors: {
        /*
          slate(차가운 회색)를 stone(따뜻한 회색) 값으로 통째로 덮어쓴다.
          컴포넌트 15개에 흩어진 `slate-*` 클래스를 하나도 안 고치고 색만 바뀐다.
          이름이 slate인데 값이 stone인 게 어색하지만, 전 파일 치환보다 되돌리기 쉽다
        */
        slate: {
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
        // 액센트는 이 하나뿐이다. 초록·빨강·노랑은 상태 표시 전용이라 액센트로 쓰지 않는다
        brand: {
          50: '#eff6f6',
          100: '#d8e9ea',
          200: '#b2d3d5',
          500: '#2b7378',
          600: '#1f5c61',
          700: '#1a4a4e',
          800: '#163a3d',
        },
      },
    },
  },
  plugins: [],
};
