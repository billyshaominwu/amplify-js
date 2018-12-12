import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectorRef } from '@angular/core';
import { AmplifyService } from '../../../providers/amplify.service';
import { ConsoleLogger as Logger } from '@aws-amplify/core';
import { isUndefined } from 'util';
require('./aws-lex-audio.js')

const logger = new Logger('ChatBot');

const template = `
<div class="amplify-interactions">
	<div class="amplify-interactions-container">
		<div class="amplify-form-container">
			<div class="amplify-form-row">
				<div class="amplify-interactions-conversation">
					<div *ngFor="let message of messages">
						<div class="amplify-interactions-input">{{message.me}}</div>
						<div class="amplify-interactions-input-timestamp">{{message.meSentTime}}</div>
						<div class="amplify-interactions-response">{{message.bot}}</div>
						<div class="amplify-interactions-response-timestamp">{{message.botSentTime}}</div>
					</div>
				</div>
			</div>
			<div class="amplify-interactions-actions">
				<input #inputValue
					type='text'
					class="amplify-form-input"
					placeholder="{{currentVoiceState}}"
					[value]="inputText"
					(keyup.enter)="onSubmit(inputValue.value)"
					(change)="onInputChange($event.target.value)"
					[disabled]="inputDisabled"
					*ngIf="textEnabled">
				<input #inputValue
					type='text'
					class="amplify-form-input"
					placeholder="{{currentVoiceState}}"
					[disabled]="!textEnabled"
					*ngIf="!textEnabled">

				<button type="button" *ngIf="voiceEnabled" ng-style="{float: 'right'}" (click)="micButtonHandler()" [disabled]="micButtonDisabled">{{micText}}</button>
				<button type="button" *ngIf="textEnabled" ng-style="{float: 'right'}" class="amplify-interactions-button" [disabled]="inputDisabled" ng-click="inputDisabled === false || onSubmit(inputValue.value)"></button>

			</div>
		</div>
	</div>
</div>
`;
declare var LexAudio: any;
const audioControl = new LexAudio.audioControl();

let STATES = {
	INITIAL: { MESSAGE: 'Type your message or click  🎤', ICON: '🎤' },
	LISTENING: { MESSAGE: 'Listening... click 🔴 again to cancel', ICON: '🔴' },
	SENDING: { MESSAGE: 'Please wait...', ICON: '🔊' },
	SPEAKING: { MESSAGE: 'Speaking...', ICON: '...' }
};

const MIC_BUTTON_TEXT = {
	PASSIVE: '🎤',
	RECORDING: '🔴',
	PLAYING: '🔊',
	LOADING: '...',
}

const defaultVoiceConfig = {
	silenceDetectionConfig: {
		time: 2000,
		amplitude: 0.2
	}
}

@Component({
	selector: 'amplify-interactions-core',
	template: template
})
export class ChatbotComponentCore {
	errorMessage: string;
	amplifyService: AmplifyService;
	inputText: string = "";
	botName: string;
	chatTitle: string;
	clearComplete: boolean = false;
	messages: any = [];
	completions: any = {};
	currentVoiceState: string = STATES.INITIAL.MESSAGE;
	inputDisabled: boolean = false;
	micText: string = MIC_BUTTON_TEXT.PASSIVE;
	voiceConfig: any = defaultVoiceConfig;
	continueConversation: boolean = false;
	micButtonDisabled: boolean = false;
	audioInput: any;
	lexResponse: any;
	conversationModeOn: boolean = false;
	ref: ChangeDetectorRef;
	voiceEnabled: boolean = false;
	textEnabled: boolean = true;

	@Output()
	complete: EventEmitter<string> = new EventEmitter<string>();

	constructor(ref: ChangeDetectorRef, amplifyService: AmplifyService) {
		this.amplifyService = amplifyService;
		this.ref = ref;
		this.continueConversation = false;
	}

	@Input()
	set data(data: any) {
		this.botName = data.bot;
		this.chatTitle = data.title;
		this.clearComplete = data.clearComplete;
		this.conversationModeOn = isUndefined(data.conversationModeOn) ? false : data.conversationModeOn;
		this.voiceEnabled = isUndefined(data.voiceEnabled) ? false : data.voiceEnabled;
		this.textEnabled = isUndefined(data.textEnabled) ? true : data.textEnabled;
		this.voiceConfig = data.voiceConfig || this.voiceConfig;
		this.performOnComplete = this.performOnComplete.bind(this);
		this.amplifyService.interactions().onComplete(this.botName, this.performOnComplete);

		if (!this.textEnabled && this.voiceEnabled) {
			this.currentVoiceState = "Click the mic button"
			STATES.INITIAL.MESSAGE = "Click the mic button"
		}

		if (!this.voiceEnabled && this.textEnabled) {
			this.currentVoiceState = "Type a message"
			STATES.INITIAL.MESSAGE = "Type a message"
		}
	}


	@Input()
	set bot(botName: string) {
		this.botName = botName;
		this.performOnComplete = this.performOnComplete.bind(this);
		this.amplifyService.interactions().onComplete(botName, this.performOnComplete);
	}

	@Input()
	set title(title: string) {
		this.chatTitle = title;
	}

	@Input()
	set clearOnComplete(clearComplete: boolean) {
		this.clearComplete = clearComplete;
	}

	performOnComplete(evt) {
		this.complete.emit(evt);
		if (this.clearComplete) {
			this.messages = [];
		}
	}

	onInputChange(value: string) {
		this.inputText = value;
	}

	onSubmit(e) {
		if (!this.inputText) {
			return;
		}
		let message = {
			'me': this.inputText,
			'meSentTime': new Date().toLocaleTimeString(),
			'bot': '',
			'botSentTime': ''
		};
		this.amplifyService.interactions().send(this.botName, this.inputText)
			.then((response: any) => {
				this.inputText = "";
				message.bot = response.message;
				message.botSentTime = new Date().toLocaleTimeString();
				this.messages.push(message);
			})
			.catch((error) => logger.error(error));
	}

	onSilenceHandler = () => {
		if (this.continueConversation !== true) {
			return;
		}
		audioControl.exportWAV((blob) => {
			this.currentVoiceState = STATES.SENDING.MESSAGE;
			this.audioInput = blob;
			this.micText = STATES.SENDING.ICON;
			this.micButtonDisabled = true;
			this.lexResponseHandler();
		});
		this.ref.detectChanges();
	}

	reset() {
		audioControl.clear();
		this.inputText = '';
		this.currentVoiceState = STATES.INITIAL.MESSAGE;
		this.inputDisabled = false;
		this.micText = STATES.INITIAL.ICON;
		this.continueConversation = false;
		this.micButtonDisabled = false;
		this.ref.detectChanges();
	}

	onError(error) {
		logger.error(error)
	}

	async lexResponseHandler() {
		if (this.continueConversation !== true) {
			return;
		}

        const interactionsMessage = {
            content: this.audioInput,
            options: {
                messageType: 'voice'
            }
		};
		
		const response = await this.amplifyService.interactions().send(this.botName, interactionsMessage);

		this.lexResponse = response;
		this.currentVoiceState = STATES.SPEAKING.MESSAGE;
		this.micText = STATES.SPEAKING.ICON;
		this.micButtonDisabled = true;

		let message = {
			'me': this.lexResponse.inputTranscript,
			'meSentTime': new Date().toLocaleTimeString(),
			'bot': '',
			'botSentTime': ''
		};

		this.inputText = "";
		message.bot = this.lexResponse.message;
		message.botSentTime = new Date().toLocaleTimeString();
		this.messages.push(message);
		this.doneSpeakingHandler();
		this.ref.detectChanges();
	}

	doneSpeakingHandler() {
		if (this.continueConversation !== true) {
			return;
		}
		if (this.lexResponse.contentType === 'audio/mpeg') {
			audioControl.play(this.lexResponse.audioStream, () => {
				if (this.lexResponse.dialogState === 'ReadyForFulfillment' ||
					this.lexResponse.dialogState === 'Fulfilled' ||
					this.lexResponse.dialogState === 'Failed' ||
					this.conversationModeOn === false) {
					this.inputDisabled = false;
					this.currentVoiceState = STATES.INITIAL.MESSAGE;
					this.micText = STATES.INITIAL.ICON;
					this.micButtonDisabled = false;
					this.continueConversation = false;
					this.ref.detectChanges();
				} else {
					this.currentVoiceState = STATES.LISTENING.MESSAGE;
					this.micText = STATES.LISTENING.ICON;
					this.micButtonDisabled = false;
					audioControl.startRecording(this.onSilenceHandler, null, this.voiceConfig.silenceDetectionConfig);
					this.ref.detectChanges();
				}
			});
		} else {
			this.inputDisabled = false;
			this.currentVoiceState = STATES.INITIAL.MESSAGE;
			this.micText = STATES.INITIAL.ICON;
			this.micButtonDisabled = false;
			this.continueConversation = false;
			this.ref.detectChanges();
		}
	}

	async micButtonHandler() {
		if (this.continueConversation === true) {
			this.reset();
			this.ref.detectChanges();
		} else {
			this.inputDisabled = true;
			this.continueConversation = true;
			this.currentVoiceState = STATES.LISTENING.MESSAGE;
			this.micText = STATES.LISTENING.ICON;
			this.micButtonDisabled = false;
			audioControl.startRecording(this.onSilenceHandler, null, this.voiceConfig.silenceDetectionConfig);
			this.ref.detectChanges();
		}
	}

}
