import { EditorDocumentSession } from '../src/editor/editor-document-session';

describe('EditorDocumentSession', () => {
  it('owns open, edit, revert, missing, and save transitions', () => {
    const session = new EditorDocumentSession();
    session.open('content/a.html', 'one', { modified: '1', size: 3 });
    session.edit('two');
    expect(session.state).toMatchObject({ path: 'content/a.html', dirty: true, revision: 2 });
    session.revert();
    expect(session.state).toMatchObject({ content: 'one', dirty: false });
    session.selectMissing();
    expect(session.state).toMatchObject({ dirty: true, capabilities: { missing: true, canWrite: true } });
    session.clear();
    expect(session.state).toMatchObject({ path: '', dirty: false, capabilities: { canWrite: false } });
  });

  it('keeps newer edits dirty when an older save completes and invalidates metadata explicitly', () => {
    const session = new EditorDocumentSession();
    session.open('a.txt', 'one', { modified: '1' });
    session.edit('saved');
    const revision = session.state.revision;
    session.edit('newer');
    expect(session.completeSave({ path: 'a.txt', content: 'saved', revision, currentContent: 'newer' })).toMatchObject({ newerEdits: true, dirty: true });
    session.invalidateMetadata();
    expect(session.state.metadataBaselineValid).toBe(false);
  });

  it('reconciles verified, preserved-dirty, and remote-conflict restart buffers', () => {
    const session = new EditorDocumentSession();
    session.open('script.py', 'saved', { modified: 'before' });
    session.edit('local');
    const snapshot = session.snapshot();
    expect(session.reconcileRestart({ path: 'script.py', revision: snapshot.revision, cleanContent: 'saved', contentAtStart: 'local', dirtyAtStart: true, remoteContent: 'remote', remoteMetadata: { modified: 'after' } })).toBe('conflict');
    session.open('script.py', 'saved');
    session.edit('newer');
    expect(session.reconcileRestart({ path: 'script.py', revision: 2, cleanContent: 'saved', contentAtStart: 'saved', dirtyAtStart: true, remoteContent: 'saved', remoteMetadata: { modified: 'after' } })).toBe('dirty-preserved');
    expect(session.state.content).toBe('newer');
  });
});
