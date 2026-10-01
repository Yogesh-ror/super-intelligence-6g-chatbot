import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Chatbot } from './chatbot';

describe('Chatbot', () => {
  let component: Chatbot;
  let fixture: ComponentFixture<Chatbot>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Chatbot],
    }).compileComponents();

    fixture = TestBed.createComponent(Chatbot);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should map assistant backend failures to clearer user-facing messages', () => {
    expect(Chatbot.getFriendlyErrorMessage('Assistant service is not configured yet.')).toBe(
      'Assistant service is not configured yet.'
    );
    expect(Chatbot.getFriendlyErrorMessage('Unable to reach the assistant.')).toBe(
      'Unable to reach your assistant. Please check the server connection.'
    );
    expect(Chatbot.getFriendlyErrorMessage('Too many messages. Please wait a minute and try again.')).toBe(
      'Too many messages. Please wait a minute and try again.'
    );
  });

  it('should split fenced code into copyable text and code blocks', () => {
    expect(component.getMessageBlocks('Try this:\n\n```ts\nconst answer = 42;\n```')).toEqual([
      { type: 'text', content: 'Try this:' },
      { type: 'code', language: 'ts', content: 'const answer = 42;' }
    ]);
  });

  it('should remove raw markdown markers from readable message text', () => {
    expect(component.getCleanMessageText('# **Plan**\n---\n- First step\n- `npm test`')).toBe(
      'Plan\n────────────────\n• First step\n• npm test'
    );
  });
});
