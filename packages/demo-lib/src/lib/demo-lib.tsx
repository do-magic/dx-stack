import styles from './demo-lib.module.scss';

export function DemoLib() {
  return (
    <div className={styles['container']}>
      <h1>Welcome to DemoLib!</h1>
    </div>
  );
}

export default DemoLib;
