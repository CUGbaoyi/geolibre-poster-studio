"""Download the France Jiangsu extract with four resumable, version-pinned ranges."""
import concurrent.futures
from email.utils import parsedate_to_datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1] / 'artifacts' / 'osm'
ROOT.mkdir(parents=True, exist_ok=True)
URL = 'https://download.openstreetmap.fr/extracts/asia/china/jiangsu-latest.osm.pbf'

def curl(*args):
    return subprocess.run(['curl', '-fLsS', '--connect-timeout', '15', *args], capture_output=True, text=True)

head = curl('-I', '--max-time', '45', URL)
head.check_returncode()
size = int(re.findall(r'(?im)^content-length:\s*(\d+)', head.stdout)[-1])
etag = re.findall(r'(?im)^etag:\s*(.+)', head.stdout)[-1].strip()
modified = re.findall(r'(?im)^last-modified:\s*(.+)', head.stdout)[-1].strip()
checksum = curl('--max-time', '45', URL.replace('jiangsu-latest.osm.pbf', 'jiangsu.osm.pbf.md5'))
checksum.check_returncode()
expected = re.search(r'\b[0-9a-fA-F]{32}\b', checksum.stdout).group(0).lower()
parts = ROOT / (etag.strip('"') + '.parts')
parts.mkdir(exist_ok=True)
(parts / 'source.json').write_text(json.dumps(dict(url=URL, bytes=size, etag=etag, lastModified=modified, md5=expected), indent=2))
chunk_size = 4 * 1024 * 1024
started = time.monotonic()

def download(index):
    first = index * chunk_size
    last = min(size, first + chunk_size) - 1
    path = parts / f'{index:03}.part'
    target = last - first + 1
    for attempt in range(8):
        have = path.stat().st_size if path.exists() else 0
        if have == target:
            return path
        if have > target:
            raise RuntimeError(f'Oversized chunk {index}')
        fragment = parts / f'{index:03}.fragment'
        headers = parts / f'{index:03}.headers'
        result = curl('--max-time', '180', '--range', f'{first + have}-{last}', '-H', f'If-Match: {etag}', '-D', str(headers), '-o', str(fragment), URL)
        received = headers.read_text() if headers.exists() else ''
        content_range = re.findall(r'(?im)^content-range:\s*bytes (\d+)-(\d+)/(\d+)', received)
        if content_range and tuple(map(int, content_range[-1])) == (first + have, last, size) and fragment.exists():
            with path.open('ab') as out:
                out.write(fragment.read_bytes())
        elif '412' in received:
            raise RuntimeError('Source changed; restart with the new version')
        fragment.unlink(missing_ok=True)
        print(json.dumps({'chunk': index, 'bytes': path.stat().st_size if path.exists() else 0, 'total': target, 'attempt': attempt + 1, 'curl': result.returncode}), flush=True)
    if not path.exists() or path.stat().st_size != target:
        raise RuntimeError(f'Chunk {index} incomplete; rerun to resume')
    return path

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    files = list(pool.map(download, range((size + chunk_size - 1) // chunk_size)))
output = ROOT / f'jiangsu-{parsedate_to_datetime(modified):%Y-%m-%d}.osm.pbf'
digest = hashlib.md5()
sha256 = hashlib.sha256()
with output.with_suffix('.assembling').open('wb') as out:
    for file in files:
        data = file.read_bytes()
        digest.update(data)
        sha256.update(data)
        out.write(data)
if digest.hexdigest() != expected:
    raise RuntimeError(f'MD5 mismatch: {digest.hexdigest()} != {expected}')
output.with_suffix('.assembling').replace(output)
report = dict(url=URL, bytes=size, etag=etag, lastModified=modified, md5=expected, sha256=sha256.hexdigest(), downloadedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), elapsedSeconds=round(time.monotonic() - started, 2))
output.with_suffix('.source.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'complete': str(output), **report}), flush=True)
