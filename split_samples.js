import fs from 'fs';
import issues from './examples/sample_issues.json' with { type: 'json' };

issues.forEach((issue, i) => {
  fs.writeFileSync(`examples/issue_${i + 1}.json`, JSON.stringify(issue, null, 2));
});