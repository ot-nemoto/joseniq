import './style.css';
import { startApp } from './ui/app';
import { openStore } from './ui/store';

// 保存を読んでから始める
openStore().then(startApp);
