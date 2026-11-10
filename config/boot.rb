ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)

require "bundler/setup" # Set up gems listed in the Gemfile.
require 'delegate'
require "rails/command"
require "rails/commands/server/server_command"
require './lib/logging'

class IOProxy < DelegateClass(IO)
  def initialize(default_stream, threadlocal_key)
    @default_stream = default_stream
    @threadlocal_key = threadlocal_key
    super(default_stream)
  end

  def write(string)
    (Thread.current[@threadlocal_key] || @default_stream).write(string)
  end

  def puts(*args)
    (Thread.current[@threadlocal_key] || @default_stream).puts(*args)
  end

  def flush
    (Thread.current[@threadlocal_key] || @default_stream).flush
  end
end

# Permanently replace stdout and stderr with a proxies that can have their destination overridden by a ThreadLocal IO
$stdout = IOProxy.new($stdout, :stdout_proxy)
$stderr = IOProxy.new($stderr, :stderr_proxy)

module Rails
  module Command
    class ServerCommand < Base
      # Override Thor's instance method 'say' (lib/thor/shell.rb:59)
      def say(message = "", color = nil, force_new_line = true)
        # Cannot use Rails.Logger because it isn't initialized yet
        formatted_message = Logging.filter_and_format(message.strip, zone: 'UTC', module: "boot")
        if formatted_message
          super(formatted_message, color, force_new_line)
        end
      end
    end
  end
end
