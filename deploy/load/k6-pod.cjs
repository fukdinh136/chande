// Runs one k6 script from deploy/load inside the cluster (image chande-load:local), with pod CPU sampled around it.
//   node deploy/load/k6-pod.cjs otp.js -e STAGES=5,10,20,30,40 -e STAGE=30s     (T2; PROXY_TOKEN is added for otp.js)
//   node deploy/load/k6-pod.cjs login.js -e STAGES=5,10,15,20,25,30 -e STAGE=1m  (T1 without port-forward)
// Results: deploy/.local/load/results/<timestamp>-<script>/ with k6.json and pods.json.
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
const {dir, kubectl} = require('./lib.cjs');

const [scriptName, ...k6Args] = process.argv.slice(2);
if (!scriptName || !fs.existsSync(path.join(__dirname, scriptName))) throw new Error('Usage: node deploy/load/k6-pod.cjs <script.js> [-e KEY=VALUE ...]');
const POD = 'load-k6', REMOTE = '/work/out';
const out = path.join(dir, 'results', new Date().toISOString().replace(/[:.]/g, '-') + '-' + path.basename(scriptName, '.js'));
fs.mkdirSync(out, {recursive: true});
const exited = child => new Promise(resolve => child.once('exit', code => resolve(code)));

(async () => {
  kubectl(['delete', 'pod', POD, '--ignore-not-found', '--wait=true']);
  kubectl(['apply', '-f', '-'], JSON.stringify({apiVersion: 'v1', kind: 'Pod', metadata: {name: POD, labels: {'app.kubernetes.io/name': POD, 'app.kubernetes.io/part-of': 'chande'}},
    spec: {restartPolicy: 'Never', automountServiceAccountToken: false, containers: [{name: POD, image: 'chande-load:local', imagePullPolicy: 'Never', command: ['sleep', '86400'],
      resources: {requests: {cpu: '100m', memory: '256Mi'}, limits: {cpu: '2', memory: '2Gi'}}}]}}));
  kubectl(['wait', '--for=condition=Ready', 'pod/' + POD, '--timeout=120s']);
  for (const name of ['drivers.json', 'riders.json', 'rider-tokens.json']) if (fs.existsSync(path.join(dir, name))) kubectl(['cp', path.join(dir, name), `${POD}:/load/deploy/.local/load/${name}`]);
  const extra = scriptName === 'otp.js' ? ['-e', 'PROXY_TOKEN=' + JSON.parse(fs.readFileSync(path.join(dir, '..', 'backend', 'credentials.json'), 'utf8')).driverProxy] : [];
  const pods = spawn(process.execPath, [path.join(__dirname, 'pods.cjs'), '--interval', '5', '--out', path.join(out, 'pods.json')], {stdio: ['ignore', 'pipe', 'inherit']});
  pods.stdout.pipe(process.stdout);
  const k6 = spawn('kubectl', ['--context', 'docker-desktop', '-n', 'chande-local', 'exec', POD, '--', 'k6', 'run', '-q', '-e', 'BACKEND_URL=http://edge:8088', ...extra, ...k6Args, '-e', `SUMMARY_OUT=${REMOTE}/k6.json`, `deploy/load/${scriptName}`], {stdio: 'inherit'});
  const code = await exited(k6);
  pods.kill('SIGTERM'); await exited(pods);
  kubectl(['cp', `${POD}:${REMOTE}/k6.json`, path.join(out, 'k6.json')]);
  kubectl(['delete', 'pod', POD, '--wait=false']);
  console.info(`k6 exit ${code}. Results: ${path.relative(process.cwd(), out)}`);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
