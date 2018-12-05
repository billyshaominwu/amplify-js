import * as React from 'react';
import { Component } from 'react';
import { Container, FormSection, SectionHeader, SectionBody, SectionFooter } from "../AmplifyUI";
import { Input, Button } from "../AmplifyTheme";

import { I18n } from '@aws-amplify/core';
import Interactions from '@aws-amplify/interactions';
import regeneratorRuntime from 'regenerator-runtime/runtime';
import { ConsoleLogger as Logger } from '@aws-amplify/core';

const logger = new Logger('ChatBot');

require('./aws-lex-audio.js')

const styles = {
    itemMe: {
        padding: 10,
        fontSize: 12,
        color: 'gray',
        marginTop: 4,
        textAlign: 'right'
    },
    itemBot: {
        fontSize: 12,
        textAlign: 'left'
    },
    list: {
        height: '300px',
        overflow: 'auto',
    },
    textInput: Object.assign({}, Input, {
        display: 'inline-block',
        width: 'calc(100% - 90px - 15px)',
    }),
    button: Object.assign({}, Button, {
        width: '60px',
        float: 'right',
    }),
    mic: Object.assign({}, Button, {
        width: '40px',
        float: 'right',
    })
};

const STATES = {
    INITIAL: { MESSAGE: 'Type your message or click  🎤',  ICON: '🎤'},
    LISTENING: { MESSAGE: 'Listening... click 🔴 again to cancel', ICON: '🔴'},
    SENDING: { MESSAGE: 'Please wait...', ICON: '🔊'},
    SPEAKING: { MESSAGE: 'Speaking...', ICON: '...'}
};

const defaultVoiceConfig = {
    silenceDetectionConfig: {
        time: 2000,
        amplitude: 0.2
    }   
}

const audioControl = new global.LexAudio.audioControl()

export class ChatBot extends Component {
    constructor(props) {
        super(props);

        if (!this.props.textEnabled && this.props.voiceEnabled) {
            STATES.INITIAL.MESSAGE = 'Click the mic button';
            styles.textInput = Object.assign({}, Input, {
                display: 'inline-block',
                width: 'calc(100% - 40px - 15px)',
            })
        }
        if (this.props.textEnabled && !this.props.voiceEnabled) {
            STATES.INITIAL.MESSAGE = 'Type a message';
            styles.textInput = Object.assign({}, Input, {
                display: 'inline-block',
                width: 'calc(100% - 60px - 15px)',
            })
        }
        if (!this.props.voiceConfig.silenceDetectionConfig) {
            throw new Error('voiceConfig prop is missing silenceDetectionConfig');
        }

        this.state = {
            dialog: [{
                message: this.props.welcomeMessage || 'Welcome to Lex',
                from: 'system'
            }],
            inputText: '',
            currentVoiceState: STATES.INITIAL,
            inputDisabled: false,
            micText: STATES.INITIAL.ICON,
            continueConversation: false,
            micButtonDisabled: false,
        }
        this.handleVoiceClick = this.handleVoiceClick.bind(this)
        this.conversationActionHandler = this.conversationActionHandler.bind(this)
        this.changeInputText = this.changeInputText.bind(this);
        this.listItems = this.listItems.bind(this);
        this.submit = this.submit.bind(this);
        this.listItemsRef = React.createRef();
        this.onSilence = this.onSilence.bind(this)
        this.onError = this.onError.bind(this)
    }

    transition(newVoiceState) { 
        if (this.state.continueConversation !== true) {
            return;
        }

        this.setState({
            currentVoiceState: newVoiceState
        })

        switch (newVoiceState) {
            case STATES.INITIAL:
                this.setState({
                    micText: STATES.INITIAL.ICON,
                    micButtonDisabled: false,
                    continueConversation: false
                })
                break;
            case STATES.LISTENING:
                this.setState({
                    micText: STATES.LISTENING.ICON,
                    micButtonDisabled: false,
                })
                break;
            case STATES.SENDING:
                this.setState({
                    micText: STATES.SENDING.ICON,
                    micButtonDisabled: true,
                })
                this.conversationActionHandler();
                break;
            case STATES.SPEAKING:
                this.setState({
                    micText: STATES.SPEAKING.ICON,
                    micButtonDisabled: true,
                })
                this.conversationActionHandler();
                break;
        }
    }

    onSilence() {
        audioControl.stopRecording();
        this.conversationActionHandler(); 
    }

    async onSuccess(response) {
        this.setState({
            dialog: [...this.state.dialog, 
                { message: response.inputTranscript, from: 'me' }, 
                response && { from: 'bot', message: response.message }],
            inputText: ''
        }) 
        this.listItemsRef.current.scrollTop = this.listItemsRef.current.scrollHeight;
    }

    onError(error) {
        logger.error(error)
    }

    reset() {
        this.setState({
            inputText: '',
            currentVoiceState: STATES.INITIAL,
            inputDisabled: false,
            micText: STATES.INITIAL.ICON,
            continueConversation: false,
            micButtonDisabled: false,
        });
        audioControl.clear();
    }

    async conversationActionHandler() {
        audioControl.supportsAudio((supported) => {
            if (!supported) {
                onError('Audio is not supported.')
            }
        });

        switch (this.state.currentVoiceState) {
            case STATES.INITIAL:
                audioControl.startRecording(this.onSilence, null, this.props.voiceConfig.silenceDetectionConfig);
                this.transition(STATES.LISTENING);
                break;
            case STATES.LISTENING:
                audioControl.exportWAV((blob) => {
                    this.setState({
                        audioInput: blob,
                    })
                    this.transition(STATES.SENDING);
                });
                break;
            case STATES.SENDING:
                if (!Interactions || typeof Interactions.send !== 'function') {
                    throw new Error('No Interactions module found, please ensure @aws-amplify/interactions is imported');
                }
        
                const response = await Interactions.send(this.props.botName, this.state.audioInput);

                this.setState({
                    lexResponse: response,
                })
                this.transition(STATES.SPEAKING)
                this.onSuccess(response)
                break;
            case STATES.SPEAKING:
                if (this.state.lexResponse.contentType === 'audio/mpeg') {
                    audioControl.play(this.state.lexResponse.audioStream, () => {
                        if (this.state.lexResponse.dialogState === 'ReadyForFulfillment' ||
                            this.state.lexResponse.dialogState === 'Fulfilled' ||
                            this.state.lexResponse.dialogState === 'Failed' ||
                            this.props.conversationModeOn === false) {
                                this.setState({
                                    inputDisabled: false,
                                    micText: STATES.INITIAL.ICON,
                                })
                            this.transition(STATES.INITIAL);
                        } else {
                            audioControl.startRecording(this.onSilence, null, this.props.voiceConfig.silenceDetectionConfig);
                            this.transition(STATES.LISTENING);
                        }
                    });
                } else {
                    this.setState({
                        inputDisabled: false
                    })
                    this.transition(STATES.INITIAL);
                }
                break;
        }
    };

    listItems() {
        return this.state.dialog.map((m, i) => {
            if (m.from === 'me') { return <div key={i} style={styles.itemMe}>{m.message}</div>; }
            else if (m.from === 'system') { return <div key={i} style={styles.itemBot}>{m.message}</div>; }
            else { return <div key={i} style={styles.itemBot}>{m.message}</div>; }
        });
    }

    async handleVoiceClick() {
        if (this.state.continueConversation === true && this.props.conversationModeOn === true) {
            this.reset();
        } else {
            await this.setState({
                inputDisabled: true,
                continueConversation: true
            })
            this.conversationActionHandler()
        }
    }

    async submit(e) {
        e.preventDefault();

        if (!this.state.inputText) {
            return;
        }

        await new Promise(resolve => this.setState({
            dialog: [
                ...this.state.dialog,
                { message: this.state.inputText, from: 'me' },
            ]
        }, resolve));

        if (!Interactions || typeof Interactions.send !== 'function') {
            throw new Error('No Interactions module found, please ensure @aws-amplify/interactions is imported');
        }

        const response = await Interactions.send(this.props.botName, this.state.inputText);

        await this.setState({
            dialog: [...this.state.dialog, response && { from: 'bot', message: response.message }],
            inputText: ''
        });
        this.listItemsRef.current.scrollTop = this.listItemsRef.current.scrollHeight;
    }

    async changeInputText(event) {
        await this.setState({ inputText: event.target.value });
    }

    getOnComplete(fn) {
        return  (...args) => {
            const { clearOnComplete } = this.props;
            const message = fn(...args);

            this.setState(
                {
                    dialog: [
                        ...(!clearOnComplete && this.state.dialog),
                        message && { from: 'bot', message }
                    ].filter(Boolean),
                },
                () => {
                    this.listItemsRef.current.scrollTop = this.listItemsRef.current.scrollHeight;
                }
            );
        };
    }

    componentDidMount() {
        const {onComplete, botName} = this.props;

        if(onComplete && botName) {
            if (!Interactions || typeof Interactions.onComplete !== 'function') {
                throw new Error('No Interactions module found, please ensure @aws-amplify/interactions is imported');
            }
            Interactions.onComplete(botName, this.getOnComplete(onComplete, this));
        }
    }

    componentDidUpdate(prevProps) {
        const {onComplete, botName} = this.props;

        if (botName && this.props.onComplete !== prevProps.onComplete) {
            if (!Interactions || typeof Interactions.onComplete !== 'function') {
                throw new Error('No Interactions module found, please ensure @aws-amplify/interactions is imported');
            }
            Interactions.onComplete(botName, this.getOnComplete(onComplete, this));
        }
    }

    render() {
        const { title, theme, onComplete } = this.props;

        return (
            <FormSection theme={theme}>
                {title && <SectionHeader theme={theme}>{I18n.get(title)}</SectionHeader>}
                <SectionBody theme={theme}>
                    <div ref={this.listItemsRef} style={styles.list}>{this.listItems()}</div>
                   </SectionBody>
                <SectionFooter theme={theme}>
                    <ChatBotInputs
                        micText={this.state.micText} 
                        voiceEnabled={this.props.voiceEnabled} 
                        textEnabled={this.props.textEnabled} 
                        styles={styles} 
                        onChange={this.changeInputText}
                        inputText={this.state.inputText}
                        onSubmit={this.submit}
                        inputDisabled={this.state.inputDisabled}
                        micButtonDisabled={this.state.micButtonDisabled}
                        handleMicButton={this.handleVoiceClick}
                        micText={this.state.micText}
                        currentVoiceState={this.state.currentVoiceState}>
                    </ChatBotInputs>
                </SectionFooter>
            </FormSection>
        );
    }
}

function ChatBotTextInput(props) {
    const styles=props.styles
    const onChange=props.onChange
    const inputText=props.inputText
    const inputDisabled=props.inputDisabled
    const currentVoiceState=props.currentVoiceState

    return(
        <input
            style={styles.textInput}
            type='text'
            placeholder={I18n.get(currentVoiceState.MESSAGE)}
            onChange={onChange}
            value={inputText}
            disabled={inputDisabled}>
        </input>
    )
}

function ChatBotMicButton(props) {
    const voiceEnabled = props.voiceEnabled;
    const styles = props.styles;
    const micButtonDisabled = props.micButtonDisabled;
    const handleMicButton = props.handleMicButton;
    const micText = props.micText;

    if (!voiceEnabled) {
        return null
    }

    return(
        <button 
            style={styles.mic} 
            disabled={micButtonDisabled} 
            onClick={handleMicButton}>
            {micText}    
        </button>
    )
}

function ChatBotTextButton(props) {
    const textEnabled = props.textEnabled;
    const styles = props.styles;
    const inputDisabled = props.inputDisabled;

    if (!textEnabled) {
        return null;
    }

    return(
        <button 
            type="submit" 
            style={styles.button} 
            disabled={inputDisabled}>
            {I18n.get('Send')}
        </button>
    )
}

function ChatBotInputs(props) {
    const voiceEnabled = props.voiceEnabled;
    const textEnabled = props.textEnabled;
    const styles = props.styles;
    const onChange = props.onChange;
    const inputDisabled = props.inputDisabled;
    const micButtonDisabled = props.micButtonDisabled;
    const inputText = props.inputText;
    const onSubmit = props.onSubmit;
    const handleMicButton = props.handleMicButton;
    const micText = props.micText;
    const currentVoiceState = props.currentVoiceState

    if (voiceEnabled && !textEnabled) {
        inputDisabled = true;
    }

    if (!voiceEnabled && !textEnabled) {
        return(<div>No Chatbot inputs enabled. Set at least one of voiceEnabled or textEnabled in the props. </div>)
    }
    
    return (
        <form onSubmit={onSubmit}>
            <ChatBotTextInput
                onSubmit={onSubmit}
                styles={styles}
                type='text'
                currentVoiceState={currentVoiceState}
                onChange={onChange}
                inputText={inputText}
                inputDisabled={inputDisabled}
            />
            <ChatBotTextButton
                onSubmit={onSubmit}
                type="submit" 
                styles={styles}
                inputDisabled={inputDisabled}
                textEnabled={textEnabled}
            />
            <ChatBotMicButton
                styles={styles}
                micButtonDisabled={micButtonDisabled} 
                handleMicButton={handleMicButton}  
                micText={micText}
                voiceEnabled={voiceEnabled}
            />
        </form>);
}

ChatBot.defaultProps = {
    title: '',
    botName: '',
    onComplete: undefined,
    clearOnComplete: false,
    voiceConfig: defaultVoiceConfig,
    conversationModeOn: false,
    voiceEnabled: true,
    textEnabled: true
};

export default ChatBot;
