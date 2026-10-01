import { Component } from '@angular/core';
import { Chatbot } from './chatbot/chatbot';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Chatbot],
  template: `<app-chatbot></app-chatbot>`,
})
export class App {}